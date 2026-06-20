import type { FastifyInstance } from "fastify";
import { sendMessageSchema } from "@aula-agente/shared";
import {
  getAdminClient,
  getConversationById,
  getInstanceById,
  getMessageByIdempotencyKey,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { saveMessage } from "../../services/message.service";
import { enqueueSendMessage } from "../../lib/queue";

export default async function messageSendRoutes(app: FastifyInstance) {
  app.post("/messages/send", {
    preHandler: [authMiddleware],
    handler: async (request, reply) => {
      const parseResult = sendMessageSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }

      const { conversation_id, content, idempotency_key } = parseResult.data;
      const db = getAdminClient();

      // Lightweight org lookup for auth check before full fetch
      const { data: convOrg } = await db
        .from("conversations")
        .select("organization_id")
        .eq("id", conversation_id)
        .single();
      if (!convOrg) {
        return reply.status(404).send({ error: "Conversa não encontrada" });
      }

      // Check user has access to this org
      const membership = request.user.memberships.find(
        (m) => m.organization_id === convOrg.organization_id
      );
      if (!membership) {
        return reply.status(403).send({ error: "Acesso negado" });
      }

      // Full fetch scoped to org (defense-in-depth)
      const conversation = await getConversationById(db, conversation_id, convOrg.organization_id);
      if (!conversation) {
        return reply.status(404).send({ error: "Conversa não encontrada" });
      }

      // C10 idempotency: check if a message with this key already exists in this conversation
      let existingMessage: Awaited<ReturnType<typeof getMessageByIdempotencyKey>> = null;
      if (idempotency_key) {
        existingMessage = await getMessageByIdempotencyKey(
          db,
          conversation_id,
          convOrg.organization_id,
          idempotency_key
        );
      }

      // Get instance for sending (always needed — used for both retry and first-time paths)
      const instance = await getInstanceById(db, conversation.evolution_instance_id, conversation.organization_id);
      if (!instance) {
        return reply.status(404).send({ error: "Instância WhatsApp não encontrada" });
      }

      // Get contact phone from conversation
      const contact = (conversation as Record<string, unknown>).contacts as { phone: string } | null;
      if (!contact?.phone) {
        return reply.status(422).send({ error: "Conversa sem número de telefone do contato" });
      }

      const jobOptions = idempotency_key ? { jobId: `idem_${idempotency_key}` } : undefined;

      // Retry path: reuse existing message, still enqueue to guarantee delivery
      if (existingMessage) {
        await enqueueSendMessage({
          conversationId: conversation_id,
          messageId: existingMessage.id,
          instanceId: instance.id,
          phone: contact.phone,
          content,
          organizationId: conversation.organization_id,
        }, jobOptions);
        return reply.status(200).send({ ok: true, messageId: existingMessage.id });
      }

      // First-time path: save message and enqueue
      const message = await saveMessage({
        conversationId: conversation_id,
        organizationId: conversation.organization_id,
        evolutionMessageId: null,
        role: "human_agent",
        content,
        metadata: idempotency_key ? { idempotency_key } : null,
      });

      if (!message) {
        return reply.status(500).send({ error: "Falha ao salvar mensagem" });
      }

      await enqueueSendMessage({
        conversationId: conversation_id,
        messageId: message.id,
        instanceId: instance.id,
        phone: contact.phone,
        content,
        organizationId: conversation.organization_id,
      }, jobOptions);

      return reply.status(200).send({ ok: true, messageId: message.id });
    },
  });
}
