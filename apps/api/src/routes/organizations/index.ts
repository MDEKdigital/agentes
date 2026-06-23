import type { FastifyInstance } from "fastify";
import {
  getAdminClient,
  getOrganizationById,
  getUserOrganizations,
  isSlugAvailableForOrg,
  completeOrganizationOnboarding,
  updateOrganizationName,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { deleteInstance } from "../../services/evolution.service";
import { fireAudit } from "../../lib/audit";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export default async function organizationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // List organizations for the current authenticated user
  app.get("/me/organizations", async (request, reply) => {
    const db = getAdminClient();
    const memberships = await getUserOrganizations(db, request.user.id);
    const orgs = (memberships ?? [])
      .map((m: Record<string, unknown>) => {
        const org = m.organizations as Record<string, unknown>;
        if (!org) return null;
        return { ...org, role: m.role };
      })
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

        fireAudit(db, {
          organization_id: organizationId,
          user_id: request.user.id,
          action: "organization.onboarding_completed",
          entity_type: "organization",
          entity_id: organizationId,
          metadata: { name, slug },
        }, request.log);

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

      fireAudit(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "organization.updated",
        entity_type: "organization",
        entity_id: organizationId,
        metadata: { name },
      }, request.log);

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
        const failures = results
          .map((result, i) => ({ result, name: instances[i].instance_name }))
          .filter(({ result }) => result.status === "rejected");

        if (failures.length > 0) {
          failures.forEach(({ result, name }) => {
            request.log.error(
              { instanceName: name, reason: (result as PromiseRejectedResult).reason },
              "Falha ao excluir instância na Evolution API"
            );
          });
          return reply.status(500).send({
            error: "Falha ao excluir instâncias na Evolution API. Organização não foi removida.",
            failed_instances: failures.map(({ name }) => name),
          });
        }
      }

      const { error } = await db.from("organizations").delete().eq("id", organizationId);
      if (error) {
        request.log.error({ error }, "Falha ao excluir organização");
        return reply.status(500).send({ error: "Erro ao excluir organização" });
      }

      fireAudit(db, {
        organization_id: null,
        user_id: request.user.id,
        action: "organization.deleted",
        entity_type: "organization",
        entity_id: organizationId,
      }, request.log);

      return reply.status(204).send();
    }
  );
}
