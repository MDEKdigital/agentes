import type { FastifyInstance } from "fastify";
import { getAdminClient, getContactsByOrganization } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { fireAudit } from "../../lib/audit";

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

  app.delete<{ Params: { organizationId: string; contactId: string } }>(
    "/organizations/:organizationId/contacts/:contactId",
    async (request, reply) => {
      const { organizationId, contactId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();

      const { data: contact } = await db
        .from("contacts")
        .select("id")
        .eq("id", contactId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (!contact) return reply.status(404).send({ error: "Lead não encontrado" });

      const { error } = await db
        .from("contacts")
        .delete()
        .eq("id", contactId)
        .eq("organization_id", organizationId);

      if (error) return reply.status(500).send({ error: "Falha ao apagar lead" });

      fireAudit(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "contact.deleted",
        entity_type: "contact",
        entity_id: contactId,
      }, request.log);

      return reply.status(204).send();
    }
  );
}
