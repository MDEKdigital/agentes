import type { FastifyInstance } from "fastify";
import { sendMessageSchema } from "@aula-agente/shared";
import { getAdminClient, getConversationById, getInstanceById } from "@aula-agente/database";
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

      const { conversation_id, content } = parseResult.data;
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

      // Save human agent message
      const message = await saveMessage({
        conversationId: conversation_id,
        organizationId: conversation.organization_id,
        evolutionMessageId: null,
        role: "human_agent",
        content,
      });

      if (!message) {
        return reply.status(500).send({ error: "Falha ao salvar mensagem" });
      }

      // Get instance for sending
      const instance = await getInstanceById(db, conversation.evolution_instance_id, conversation.organization_id);
      if (!instance) {
        return reply.status(404).send({ error: "Instância WhatsApp não encontrada" });
      }

      // Get contact phone from conversation
      const contact = (conversation as Record<string, unknown>).contacts as { phone: string } | null;
      if (!contact?.phone) {
        return reply.status(422).send({ error: "Conversa sem número de telefone do contato" });
      }

      // Enqueue send
      await enqueueSendMessage({
        conversationId: conversation_id,
        messageId: message.id,
        instanceId: instance.id,
        phone: contact.phone,
        content,
        organizationId: conversation.organization_id,
      });

      return reply.status(200).send({ ok: true, messageId: message.id });
    },
  });
}
