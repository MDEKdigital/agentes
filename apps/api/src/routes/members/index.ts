import type { FastifyInstance } from "fastify";
import {
  getAdminClient,
  getOrgMembersWithEmail,
  getMemberById,
  updateMemberRole,
  removeMember,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { fireAudit } from "../../lib/audit";

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
      let members;
      try {
        members = await getOrgMembersWithEmail(db, organizationId);
      } catch (err) {
        request.log.error({ err, organizationId }, "getOrgMembersWithEmail failed");
        return reply.status(500).send({ error: "Failed to fetch members" });
      }
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
      if (role === "owner") {
        return reply.status(403).send({ error: "Não é possível promover membros para proprietário por esta rota." });
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
      if ((target.role === "admin" || role === "admin") && membership.role !== "owner") {
        return reply.status(403).send({ error: "Apenas proprietários podem gerenciar admins." });
      }

      const updated = await updateMemberRole(db, organizationId, memberId, role as MemberRoleType);

      fireAudit(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "member.role_changed",
        entity_type: "member",
        entity_id: memberId,
        metadata: { old_role: target.role, new_role: role },
      }, request.log);

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

      fireAudit(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "member.removed",
        entity_type: "member",
        entity_id: memberId,
        metadata: { removed_user_id: target.user_id, role: target.role },
      }, request.log);

      return reply.status(204).send();
    }
  );
}
