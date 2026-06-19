import type { FastifyInstance } from "fastify";
import { getAdminClient, createAgent, checkResourceLimit, getAgentsByOrganization, getAgentById, updateAgent, deleteAgent, resetAgentConversationsKeywordActivation, createAuditLog } from "@aula-agente/database";
import { createAgentSchema, updateAgentSchema } from "@aula-agente/shared";
import { authMiddleware } from "../../middleware/auth";

export default async function agentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/agents",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Acesso de administrador necessário" });
      }

      const parseResult = createAgentSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }

      const db = getAdminClient();

      const limit = await checkResourceLimit(db, organizationId, "agents");
      if (!limit.allowed) {
        return reply.status(403).send({
          error: `Limite de agentes atingido. Seu plano permite ${limit.max} agente(s).`,
          limit_exceeded: true,
        });
      }

      const agent = await createAgent(db, {
        ...parseResult.data,
        organization_id: organizationId,
        is_active: true,
      });

      createAuditLog(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "agent.created",
        entity_type: "agent",
        entity_id: agent.id,
        metadata: { name: agent.name },
      }).catch((err) => request.log.error({ err }, "audit: agent.created failed"));

      return reply.status(201).send(agent);
    }
  );

  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/agents",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const agents = await getAgentsByOrganization(db, organizationId);
      return reply.send({ agents });
    }
  );

  app.get<{ Params: { organizationId: string; agentId: string } }>(
    "/organizations/:organizationId/agents/:agentId",
    async (request, reply) => {
      const { organizationId, agentId } = request.params;
      const membership = request.user.memberships.find((m) => m.organization_id === organizationId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const agent = await getAgentById(db, agentId, organizationId);
      if (!agent) return reply.status(404).send({ error: "Agente não encontrado." });
      return reply.send(agent);
    }
  );

  app.patch<{ Params: { organizationId: string; agentId: string } }>(
    "/organizations/:organizationId/agents/:agentId",
    async (request, reply) => {
      const { organizationId, agentId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const existing = await getAgentById(db, agentId, organizationId);
      if (!existing) return reply.status(404).send({ error: "Agente não encontrado." });

      const parseResult = updateAgentSchema.strict().safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }
      const updated = await updateAgent(db, agentId, organizationId, parseResult.data);

      const oldRules = existing.activation_rules ?? [];
      const newRules = parseResult.data.activation_rules ?? oldRules;
      const hadRules = oldRules.length > 0;
      const hasRules = newRules.length > 0;
      if (!hadRules && hasRules) {
        await resetAgentConversationsKeywordActivation(db, agentId, false);
      } else if (hadRules && !hasRules) {
        await resetAgentConversationsKeywordActivation(db, agentId, true);
      }

      // R7: audit fires AFTER side effects — if reset throws above, no false-success audit
      createAuditLog(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "agent.updated",
        entity_type: "agent",
        entity_id: agentId,
        metadata: { fields: Object.keys(parseResult.data) },
      }).catch((err) => request.log.error({ err }, "audit: agent.updated failed"));

      return reply.send(updated);
    }
  );

  app.delete<{ Params: { organizationId: string; agentId: string } }>(
    "/organizations/:organizationId/agents/:agentId",
    async (request, reply) => {
      const { organizationId, agentId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const existing = await getAgentById(db, agentId, organizationId);
      if (!existing) return reply.status(404).send({ error: "Agente não encontrado." });

      await deleteAgent(db, agentId, organizationId);

      createAuditLog(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "agent.deleted",
        entity_type: "agent",
        entity_id: agentId,
        metadata: { name: existing.name },
      }).catch((err) => request.log.error({ err }, "audit: agent.deleted failed"));

      return reply.status(204).send();
    }
  );
}
