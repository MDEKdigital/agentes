import type { FastifyInstance } from "fastify";
import {
  getAdminClient,
  getOrgMembersWithEmail,
  getMemberById,
  updateMemberRole,
  removeMember,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

const VALID_ROLES = ["owner", "admin", "agent"] as const;
type MemberRoleType = (typeof VALID_ROLES)[number];

export default async function membersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/members",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) {
        return reply.status(403).send({ error: "Acesso negado" });
      }

      const db = getAdminClient();
      const members = await getOrgMembersWithEmail(db, organizationId);
      return reply.send({ members, current_user_id: request.user.id });
    }
  );

  app.patch<{ Params: { organizationId: string; memberId: string } }>(
    "/organizations/:organizationId/members/:memberId",
    async (request, reply) => {
      const { organizationId, memberId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Acesso de administrador necessário" });
      }

      const body = request.body as Record<string, unknown> | null | undefined;
      const role = typeof body?.role === "string" ? body.role : "";
      if (!VALID_ROLES.includes(role as MemberRoleType)) {
        return reply.status(400).send({ error: "Função inválida. Use: owner, admin ou agent." });
      }

      const db = getAdminClient();
      const target = await getMemberById(db, organizationId, memberId);
      if (!target) {
        return reply.status(404).send({ error: "Membro não encontrado." });
      }
      if (target.role === "owner") {
        return reply.status(403).send({ error: "Não é possível alterar a função de um proprietário." });
      }
      if (target.user_id === request.user.id) {
        return reply.status(403).send({ error: "Não é possível alterar o próprio role." });
      }

      const updated = await updateMemberRole(db, organizationId, memberId, role as MemberRoleType);
      return reply.send(updated);
    }
  );

  app.delete<{ Params: { organizationId: string; memberId: string } }>(
    "/organizations/:organizationId/members/:memberId",
    async (request, reply) => {
      const { organizationId, memberId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role === "owner"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Apenas proprietários podem remover membros" });
      }

      const db = getAdminClient();
      const target = await getMemberById(db, organizationId, memberId);
      if (!target) {
        return reply.status(404).send({ error: "Membro não encontrado." });
      }
      if (target.role === "owner") {
        return reply.status(403).send({ error: "Não é possível remover um proprietário." });
      }
      if (target.user_id === request.user.id) {
        return reply.status(403).send({ error: "Não é possível remover a própria membership." });
      }

      await removeMember(db, organizationId, memberId);
      return reply.status(204).send();
    }
  );
}
