import type { FastifyInstance } from "fastify";
import { createAgentSchema } from "@aula-agente/shared";
import { getAdminClient, createAgent, checkResourceLimit } from "@aula-agente/database";
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

      return reply.status(201).send(agent);
    }
  );
}
