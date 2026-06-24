import type { FastifyInstance } from "fastify";
import { getAdminClient, getContactsByOrganization } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

export default async function contactRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/contacts",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const contacts = await getContactsByOrganization(db, organizationId);
      return reply.send({ contacts });
    }
  );
}
