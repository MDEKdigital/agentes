import type { FastifyInstance } from "fastify";
import { createFaqSchema, updateFaqSchema } from "@aula-agente/shared";
import { getAdminClient, getFaqsByAgent, createFaq, updateFaq, deleteFaq, getAgentById } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

export default async function knowledgeFaqRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // List FAQs for an agent
  app.get<{ Params: { organizationId: string; agentId: string } }>(
    "/organizations/:organizationId/agents/:agentId/faqs",
    async (request, reply) => {
      const { organizationId, agentId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const agent = await getAgentById(db, agentId, organizationId);
      if (!agent) return reply.status(404).send({ error: "Agente não encontrado" });

      const faqs = await getFaqsByAgent(db, agentId, organizationId);
      return faqs;
    }
  );

  // Create FAQ
  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/faqs",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const parseResult = createFaqSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }

      const db = getAdminClient();

      const agent = await getAgentById(db, parseResult.data.agent_id, organizationId);
      if (!agent) return reply.status(404).send({ error: "Agente não encontrado" });

      const faq = await createFaq(db, {
        ...parseResult.data,
        organization_id: organizationId,
        is_active: true,
      });

      return reply.status(201).send(faq);
    }
  );

  // Update FAQ
  app.patch<{ Params: { faqId: string } }>(
    "/faqs/:faqId",
    async (request, reply) => {
      const parseResult = updateFaqSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }

      const db = getAdminClient();
      const { data: faq } = await db
        .from("knowledge_faqs")
        .select("organization_id")
        .eq("id", request.params.faqId)
        .single();

      if (!faq) return reply.status(404).send({ error: "FAQ não encontrada" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === faq.organization_id && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const updated = await updateFaq(db, request.params.faqId, parseResult.data);
      return updated;
    }
  );

  // Delete FAQ
  app.delete<{ Params: { faqId: string } }>(
    "/faqs/:faqId",
    async (request, reply) => {
      const db = getAdminClient();
      const { data: faq } = await db
        .from("knowledge_faqs")
        .select("organization_id")
        .eq("id", request.params.faqId)
        .single();

      if (!faq) return reply.status(404).send({ error: "FAQ não encontrada" });

      const membership = request.user.memberships.find(
        (m) => m.organization_id === faq.organization_id && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      await deleteFaq(db, request.params.faqId, faq.organization_id);
      return reply.status(204).send();
    }
  );
}
