import type { FastifyInstance } from "fastify";
import {
  getAdminClient,
  getOrganizationById,
  getUserOrganizations,
  isSlugAvailableForOrg,
  completeOrganizationOnboarding,
  updateOrganizationName,
  createAuditLog,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { deleteInstance } from "../../services/evolution.service";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export default async function organizationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // List organizations for the current authenticated user
  app.get("/me/organizations", async (request, reply) => {
    const db = getAdminClient();
    const memberships = await getUserOrganizations(db, request.user.id);
    const orgs = (memberships ?? [])
      .map((m: Record<string, unknown>) => m.organizations as Record<string, unknown>)
      .filter(Boolean);
    return reply.send(orgs);
  });

  app.patch<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/onboarding",
    async (request, reply) => {
      const { organizationId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

      if (!name) {
        return reply.status(400).send({ error: "Nome é obrigatório." });
      }
      if (!slug || !SLUG_RE.test(slug)) {
        return reply.status(400).send({ error: "Slug inválido. Use apenas letras minúsculas, números e hífens." });
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role === "owner"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Apenas proprietários podem configurar a organização." });
      }

      const db = getAdminClient();

      try {
        await getOrganizationById(db, organizationId);
      } catch {
        return reply.status(404).send({ error: "Organização não encontrada." });
      }

      let slugAvailable: boolean;
      try {
        slugAvailable = await isSlugAvailableForOrg(db, slug, organizationId);
      } catch (err) {
        request.log.error({ err }, "onboarding: db error checking slug");
        return reply.status(500).send({ error: "Erro interno." });
      }

      if (!slugAvailable) {
        return reply.status(409).send({ error: "Este slug já está em uso por outra organização." });
      }

      try {
        const updated = await completeOrganizationOnboarding(db, organizationId, name, slug);

        createAuditLog(db, {
          organization_id: organizationId,
          user_id: request.user.id,
          action: "organization.onboarding_completed",
          entity_type: "organization",
          entity_id: organizationId,
          metadata: { name, slug },
        }).catch((err) => request.log.error({ err }, "audit: organization.onboarding_completed failed"));

        return reply.send(updated);
      } catch (err) {
        request.log.error({ err }, "onboarding: db error updating org");
        return reply.status(500).send({ error: "Erro interno." });
      }
    }
  );

  app.patch<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role === "owner"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Apenas proprietários podem alterar o nome da organização." });
      }

      const body = request.body as Record<string, unknown> | null | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) {
        return reply.status(400).send({ error: "Nome é obrigatório." });
      }

      const db = getAdminClient();
      const org = await updateOrganizationName(db, organizationId, name);

      createAuditLog(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "organization.updated",
        entity_type: "organization",
        entity_id: organizationId,
        metadata: { name },
      }).catch((err) => request.log.error({ err }, "audit: organization.updated failed"));

      return reply.send(org);
    }
  );

  app.delete<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role === "owner"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Apenas proprietários podem excluir a organização" });
      }

      const db = getAdminClient();

      // Delete instances from Evolution API before removing from DB
      const { data: instances } = await db
        .from("evolution_instances")
        .select("instance_name")
        .eq("organization_id", organizationId);

      if (instances && instances.length > 0) {
        const results = await Promise.allSettled(
          instances.map((inst) => deleteInstance(inst.instance_name))
        );
        results.forEach((result, i) => {
          if (result.status === "rejected") {
            request.log.error(
              { instanceName: instances[i].instance_name, reason: result.reason },
              "Falha ao excluir instância na Evolution API"
            );
          }
        });
      }

      const { error } = await db.from("organizations").delete().eq("id", organizationId);
      if (error) {
        request.log.error({ error }, "Falha ao excluir organização");
        return reply.status(500).send({ error: "Erro ao excluir organização" });
      }

      createAuditLog(db, {
        organization_id: null,
        user_id: request.user.id,
        action: "organization.deleted",
        entity_type: "organization",
        entity_id: organizationId,
      }).catch((err) => request.log.error({ err }, "audit: organization.deleted failed"));

      return reply.status(204).send();
    }
  );
}
