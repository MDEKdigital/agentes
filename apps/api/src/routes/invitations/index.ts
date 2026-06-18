import type { FastifyInstance } from "fastify";
import { getAdminClient, createInvitation, checkResourceLimit, getOrgInvitations } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["owner", "admin", "agent"] as const;
type InvitationRole = (typeof VALID_ROLES)[number];

export default async function invitationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/invitations",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Acesso de administrador necessário" });
      }

      const db = getAdminClient();
      const invitations = await getOrgInvitations(db, organizationId);
      return reply.send({ invitations });
    }
  );

  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/invitations",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Acesso de administrador necessário" });
      }

      const body = request.body as Record<string, unknown> | null | undefined;
      const email = typeof body?.email === "string" ? body.email.trim() : "";
      const role = typeof body?.role === "string" ? body.role : "";

      if (!email || !EMAIL_RE.test(email)) {
        return reply.status(400).send({ error: "Email inválido." });
      }
      if (!VALID_ROLES.includes(role as InvitationRole)) {
        return reply.status(400).send({ error: "Função inválida. Use: owner, admin ou agent." });
      }

      const db = getAdminClient();

      const limit = await checkResourceLimit(db, organizationId, "members");
      if (!limit.allowed) {
        return reply.status(403).send({
          error: `Limite de membros atingido. Seu plano permite ${limit.max} membro(s).`,
          limit_exceeded: true,
        });
      }

      const invitation = await createInvitation(db, {
        organization_id: organizationId,
        email,
        role: role as InvitationRole,
        invited_by: request.user.id,
      });

      return reply.status(201).send(invitation);
    }
  );
}
