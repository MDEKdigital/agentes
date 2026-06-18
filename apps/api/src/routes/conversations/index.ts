import type { FastifyInstance } from "fastify";
import { getAdminClient, getConversationNotes, addConversationNote, updateConversationTags, getConversationById, getMessagesByConversation, getInboxConversations } from "@aula-agente/database";
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

  app.get<{
    Params: { organizationId: string };
    Querystring: { status?: string };
  }>(
    "/organizations/:organizationId/conversations",
    async (request, reply) => {
      const { organizationId } = request.params;
      const { status } = request.query;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const conversations = await getInboxConversations(db, organizationId, status);
      return reply.send(conversations);
    }
  );

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId",
    async (request, reply) => {
      const { conversationId } = request.params;
      const db = getAdminClient();

      const conv = await getConversationById(db, conversationId);
      if (!conv) return reply.status(404).send({ error: "Conversa não encontrada" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === (conv as Record<string, unknown>).organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      return reply.send(conv);
    }
  );

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/messages",
    async (request, reply) => {
      const { conversationId } = request.params;
      const db = getAdminClient();

      const conv = await getConversationById(db, conversationId);
      if (!conv) return reply.status(404).send({ error: "Conversa não encontrada" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === (conv as Record<string, unknown>).organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const messages = await getMessagesByConversation(db, conversationId);
      return reply.send({ messages });
    }
  );

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/notes",
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
        (m) => m.organization_id === conv.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const notes = await getConversationNotes(db, conversationId);
      return reply.send({ notes });
    }
  );

  app.post<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/notes",
    async (request, reply) => {
      const { conversationId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;
      const content = typeof body?.content === "string" ? body.content.trim() : "";

      if (!content) {
        return reply.status(400).send({ error: "Conteúdo da nota é obrigatório." });
      }

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

      const note = await addConversationNote(db, {
        conversation_id: conversationId,
        organization_id: conv.organization_id,
        user_id: request.user.id,
        content,
      });

      return reply.status(201).send(note);
    }
  );

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

  app.patch<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/takeover",
    async (request, reply) => {
      const { conversationId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;

      if (typeof body?.takeover !== "boolean") {
        return reply.status(400).send({ error: "Campo 'takeover' (boolean) é obrigatório." });
      }
      const takeover = body.takeover as boolean;

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
        .update({
          is_human_takeover: takeover,
          human_takeover_at: takeover ? new Date().toISOString() : null,
          assigned_to: takeover ? request.user.id : null,
        })
        .eq("id", conversationId)
        .eq("organization_id", conv.organization_id);

      if (error) return reply.status(500).send({ error: "Falha ao atualizar takeover" });
      return reply.status(204).send();
    }
  );

  app.patch<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/tags",
    async (request, reply) => {
      const { conversationId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;

      if (!body || !Array.isArray(body.tags)) {
        return reply.status(400).send({ error: "Campo 'tags' (array) é obrigatório." });
      }
      const tags = body.tags as string[];

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

      await updateConversationTags(db, conversationId, conv.organization_id, tags);
      return reply.status(204).send();
    }
  );

  app.patch<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/assignment",
    async (request, reply) => {
      const { conversationId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;

      if (!body || !("assigned_to" in body)) {
        return reply.status(400).send({ error: "Campo 'assigned_to' é obrigatório." });
      }
      const assignedTo = body.assigned_to as string | null;

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
        .update({ assigned_to: assignedTo })
        .eq("id", conversationId)
        .eq("organization_id", conv.organization_id);

      if (error) return reply.status(500).send({ error: "Falha ao atualizar atribuição" });
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
