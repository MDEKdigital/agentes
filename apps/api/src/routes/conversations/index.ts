import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

const STATUS_SCHEMA = {
  schema: {
    body: {
      type: "object",
      required: ["status"],
      properties: {
        status: {
          type: "string",
          enum: ["open", "waiting", "resolved", "closed"],
        },
      },
    },
  },
};

export default async function conversationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.patch<{
    Params: { conversationId: string };
    Body: { status: "open" | "waiting" | "resolved" | "closed" };
  }>(
    "/conversations/:conversationId/status",
    STATUS_SCHEMA,
    async (request, reply) => {
      const { conversationId } = request.params;
      const { status } = request.body;

      const db = getAdminClient();

      const { data: conv } = await db
        .from("conversations")
        .select("organization_id")
        .eq("id", conversationId)
        .single();

      if (!conv) return reply.status(404).send({ error: "Conversa não encontrada" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === conv.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const { error } = await db
        .from("conversations")
        .update({ status })
        .eq("id", conversationId)
        .eq("organization_id", conv.organization_id);

      if (error) return reply.status(500).send({ error: "Falha ao atualizar status da conversa" });
      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId",
    async (request, reply) => {
      const { conversationId } = request.params;
      const db = getAdminClient();

      const { data: conv } = await db
        .from("conversations")
        .select("organization_id")
        .eq("id", conversationId)
        .single();

      if (!conv) return reply.status(404).send({ error: "Conversa não encontrada" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === conv.organization_id && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const { error } = await db
        .from("conversations")
        .delete()
        .eq("id", conversationId)
        .eq("organization_id", conv.organization_id);

      if (error) return reply.status(500).send({ error: "Falha ao deletar conversa" });
      return reply.status(204).send();
    }
  );
}
