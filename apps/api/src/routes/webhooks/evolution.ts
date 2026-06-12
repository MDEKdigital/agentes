import type { FastifyInstance } from "fastify";
import { evolutionWebhookPayloadSchema } from "@aula-agente/shared";
import { getAdminClient, getInstanceByInstanceId } from "@aula-agente/database";
import { webhookVerifyMiddleware } from "../../middleware/webhook-verify";
import { ensureConversation } from "../../services/conversation.service";
import { saveMessage } from "../../services/message.service";
import { enqueueProcessMessage } from "../../lib/queue";
import type { MediaType } from "@aula-agente/shared";

export function extractMessageContent(data: Record<string, unknown>): { content: string; mediaType: MediaType | null; mediaUrl: string | null } {
  const message = data.message as Record<string, unknown> | undefined;
  const messageType = data.messageType as string;

  if (!message) return { content: "", mediaType: null, mediaUrl: null };

  switch (messageType) {
    case "conversation":
      return { content: (message.conversation as string) || "", mediaType: null, mediaUrl: null };
    case "imageMessage": {
      const img = message.imageMessage as Record<string, string> | undefined;
      return {
        content: img?.caption || "[imagem]",
        mediaType: "image",
        mediaUrl: img?.url || null,
      };
    }
    case "audioMessage": {
      const audio = message.audioMessage as Record<string, string> | undefined;
      return { content: "[áudio]", mediaType: "audio", mediaUrl: audio?.url || null };
    }
    case "videoMessage":
      return {
        content: (message.videoMessage as Record<string, string>)?.caption || "[vídeo]",
        mediaType: "video",
        mediaUrl: null,
      };
    case "documentMessage":
      return {
        content: (message.documentMessage as Record<string, string>)?.fileName || "[documento]",
        mediaType: "document",
        mediaUrl: null,
      };
    case "stickerMessage":
      return { content: "[sticker]", mediaType: "sticker", mediaUrl: null };
    case "locationMessage": {
      const loc = message.locationMessage as Record<string, number> | undefined;
      return {
        content: `[localização: ${loc?.degreesLatitude}, ${loc?.degreesLongitude}]`,
        mediaType: "location",
        mediaUrl: null,
      };
    }
    default:
      return { content: "", mediaType: null, mediaUrl: null };
  }
}

export default async function evolutionWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/evolution", {
    preHandler: [webhookVerifyMiddleware],
    handler: async (request, reply) => {
      const parseResult = evolutionWebhookPayloadSchema.safeParse(request.body);

      if (!parseResult.success) {
        request.log.warn({ errors: parseResult.error.issues }, "Invalid webhook payload");
        return reply.status(400).send({ error: "Payload inválido" });
      }

      const payload = parseResult.data;

      // Ignore messages from us
      if (payload.data.key.fromMe) {
        return reply.status(200).send({ ok: true, skipped: "fromMe" });
      }

      const instanceId = payload.instance;
      const evolutionMessageId = payload.data.key.id;
      const phone = payload.data.key.remoteJid.replace("@s.whatsapp.net", "");
      const contactName = payload.data.pushName || null;

      // Look up instance — distinguish "not found" from transient DB errors
      let instance;
      try {
        instance = await getInstanceByInstanceId(getAdminClient(), instanceId);
      } catch (err) {
        const pgErr = err as { code?: string };
        if (pgErr?.code === "PGRST116") {
          request.log.warn({ instanceId }, "Unknown Evolution instance");
          return reply.status(200).send({ ok: true, skipped: "unknown_instance" });
        }
        // Transient DB error — return 500 so Evolution retries
        request.log.error({ err, instanceId }, "DB error looking up instance");
        return reply.status(500).send({ error: "Internal server error" });
      }

      // Check if instance has an active agent
      if (!instance.active_agent_id) {
        request.log.warn({ instanceId }, "Instance has no active agent");
        return reply.status(200).send({ ok: true, skipped: "no_agent" });
      }

      const organizationId = instance.organization_id;
      const agentId = instance.active_agent_id;

      try {
        // Ensure conversation exists
        const { conversation } = await ensureConversation({
          organizationId,
          agentId,
          instanceId: instance.id,
          phone,
          contactName,
          contactPhotoUrl: null,
        });

        // Extract message content
        const { content, mediaType, mediaUrl } = extractMessageContent(payload.data as Record<string, unknown>);

        // Save message (with idempotency)
        const message = await saveMessage({
          conversationId: conversation.id,
          organizationId,
          evolutionMessageId,
          role: "contact",
          content,
          mediaType,
          mediaUrl,
        });

        // If message was already processed (duplicate webhook), skip
        if (!message) {
          return reply.status(200).send({ ok: true, skipped: "duplicate" });
        }

        // If human takeover is active, don't enqueue for LLM processing
        if (conversation.is_human_takeover) {
          return reply.status(200).send({ ok: true, skipped: "human_takeover" });
        }

        // Enqueue for LLM processing
        await enqueueProcessMessage({
          conversationId: conversation.id,
          messageId: message.id,
          agentId,
          organizationId,
        });

        return reply.status(200).send({ ok: true, messageId: message.id });
      } catch (err) {
        request.log.error({ err, instanceId }, "Failed to process webhook message");
        return reply.status(500).send({ error: "Internal server error" });
      }
    },
  });
}
