import type { FastifyInstance } from "fastify";
import {
  getAdminClient,
  getAllOrganizationsWithSubscriptions,
  createManualSubscription,
  updateSubscriptionAdmin,
  cancelSubscriptionAdmin,
  findOwnerInvitationByOrg,
  getActivePlans,
  renewInvitationExpiry,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { superAdminMiddleware } from "../../middleware/super-admin";
import { sendWelcomeEmailApi } from "../../lib/email";
import { fireAudit } from "../../lib/audit";
import { type BillingInterval, type SubscriptionStatus } from "@aula-agente/shared";
import { isValidProvider, upsertOrgSecret } from "../../lib/providers";

const VALID_INTERVALS = new Set<BillingInterval>(["manual", "monthly", "yearly", "lifetime"]);
const VALID_STATUSES = new Set<SubscriptionStatus>(["active", "cancelled", "past_due", "paused", "trial"]);

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", superAdminMiddleware);

  // GET /admin/organizations
  app.get("/admin/organizations", async (request, reply) => {
    const db = getAdminClient();
    try {
      const [orgs, plans] = await Promise.all([
        getAllOrganizationsWithSubscriptions(db),
        getActivePlans(db),
      ]);
      return reply.send({ orgs, plans });
    } catch (err) {
      request.log.error({ err }, "admin: failed to load organizations");
      return reply.status(500).send({ error: "Erro ao carregar organizações." });
    }
  });

  // POST /admin/organizations/:orgId/subscriptions
  app.post<{ Params: { orgId: string } }>(
    "/admin/organizations/:orgId/subscriptions",
    async (request, reply) => {
      const { orgId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;
      const planId = typeof body?.plan_id === "string" ? body.plan_id.trim() : "";
      const interval = typeof body?.billing_interval === "string" ? body.billing_interval : "";

      if (!planId) return reply.status(400).send({ error: "plan_id é obrigatório." });
      if (!VALID_INTERVALS.has(interval as BillingInterval)) {
        return reply.status(400).send({ error: "billing_interval inválido." });
      }

      const db = getAdminClient();
      try {
        const sub = await createManualSubscription(db, orgId, planId, interval as BillingInterval);
        void fireAudit(
          db,
          {
            organization_id: orgId,
            user_id: request.user.id,
            action: "plan.activated",
            entity_type: "plan",
            entity_id: sub.id,
            metadata: { plan_id: planId, billing_interval: interval, source: "admin_manual" },
          },
          request.log
        );
        return reply.status(201).send({ subscription: sub });
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        if (e.message === "SUBSCRIPTION_EXISTS") {
          return reply.status(409).send({ error: "Organização já possui assinatura. Use PATCH para atualizar." });
        }
        request.log.error({ err }, "admin: failed to create manual subscription");
        return reply.status(500).send({ error: "Erro ao criar assinatura." });
      }
    }
  );

  // PATCH /admin/subscriptions/:subId
  app.patch<{ Params: { subId: string } }>(
    "/admin/subscriptions/:subId",
    async (request, reply) => {
      const { subId } = request.params;
      const body = request.body as Record<string, unknown> | null | undefined;

      const fields: Record<string, unknown> = {};
      if (typeof body?.plan_id === "string") fields.plan_id = body.plan_id;
      if (typeof body?.status === "string") {
        if (!VALID_STATUSES.has(body.status as SubscriptionStatus)) {
          return reply.status(400).send({ error: "status inválido." });
        }
        fields.status = body.status;
      }
      if (typeof body?.current_period_end === "string") fields.current_period_end = body.current_period_end;
      if (typeof body?.billing_interval === "string") {
        if (!VALID_INTERVALS.has(body.billing_interval as BillingInterval)) {
          return reply.status(400).send({ error: "billing_interval inválido." });
        }
        fields.billing_interval = body.billing_interval;
      }
      if (Object.keys(fields).length === 0) {
        return reply.status(400).send({ error: "Nenhum campo válido para atualizar." });
      }

      const db = getAdminClient();
      try {
        const sub = await updateSubscriptionAdmin(
          db,
          subId,
          fields as Parameters<typeof updateSubscriptionAdmin>[2]
        );
        void fireAudit(
          db,
          {
            organization_id: sub.organization_id,
            user_id: request.user.id,
            action: "plan.renewed",
            entity_type: "plan",
            entity_id: subId,
            metadata: { ...fields, source: "admin_update" },
          },
          request.log
        );
        return reply.send({ subscription: sub });
      } catch (err) {
        request.log.error({ err }, "admin: failed to update subscription");
        return reply.status(500).send({ error: "Erro ao atualizar assinatura." });
      }
    }
  );

  // DELETE /admin/subscriptions/:subId
  app.delete<{ Params: { subId: string } }>(
    "/admin/subscriptions/:subId",
    async (request, reply) => {
      const { subId } = request.params;
      const db = getAdminClient();
      try {
        const sub = await cancelSubscriptionAdmin(db, subId);
        void fireAudit(
          db,
          {
            organization_id: sub.organization_id,
            user_id: request.user.id,
            action: "plan.cancelled",
            entity_type: "plan",
            entity_id: subId,
            metadata: { source: "admin_cancel" },
          },
          request.log
        );
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "admin: failed to cancel subscription");
        return reply.status(500).send({ error: "Erro ao cancelar assinatura." });
      }
    }
  );

  // POST /admin/organizations/:orgId/resend-invitation
  app.post<{ Params: { orgId: string } }>(
    "/admin/organizations/:orgId/resend-invitation",
    async (request, reply) => {
      const { orgId } = request.params;
      const db = getAdminClient();

      const invitation = await findOwnerInvitationByOrg(db, orgId).catch(() => null);
      if (!invitation) {
        return reply.status(404).send({ error: "Nenhum convite de owner pendente para esta organização." });
      }

      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await renewInvitationExpiry(db, invitation.id, newExpiresAt);

      try {
        await sendWelcomeEmailApi({
          to: invitation.email,
          name: invitation.email,
          invitationId: invitation.id,
        });
      } catch (err) {
        request.log.error({ err }, "admin: resend invitation email failed (non-fatal)");
      }

      void fireAudit(
        db,
        {
          organization_id: orgId,
          user_id: request.user.id,
          action: "invitation.resent",
          entity_type: "invitation",
          entity_id: invitation.id,
          metadata: { email: invitation.email, source: "admin_resend" },
        },
        request.log
      );

      return reply.send({ message: "Convite reenviado para " + invitation.email });
    }
  );

  // GET /admin/organizations/:orgId/secrets
  app.get<{ Params: { orgId: string } }>(
    "/admin/organizations/:orgId/secrets",
    async (request, reply) => {
      const { orgId } = request.params;
      const db = getAdminClient();
      const { data, error } = await db
        .from("organization_secrets")
        .select("provider")
        .eq("organization_id", orgId);
      if (error) return reply.status(500).send({ error: "Erro ao buscar secrets." });
      return reply.send((data ?? []).map((s) => ({ provider: s.provider, has_key: true })));
    }
  );

  // PUT /admin/organizations/:orgId/secrets/:provider
  app.put<{ Params: { orgId: string; provider: string }; Body: { key: string } }>(
    "/admin/organizations/:orgId/secrets/:provider",
    async (request, reply) => {
      const { orgId, provider } = request.params;
      const { key } = request.body;
      if (!key?.trim()) return reply.status(400).send({ error: "Chave obrigatória." });
      if (!isValidProvider(provider)) {
        return reply.status(400).send({ error: "Provider inválido." });
      }
      const db = getAdminClient();
      const { error } = await upsertOrgSecret(db, orgId, provider, key);
      if (error) return reply.status(500).send({ error: "Erro ao salvar chave." });
      void fireAudit(db, {
        organization_id: orgId,
        user_id: request.user.id,
        action: "secret.upserted",
        entity_type: "secret",
        entity_id: `${orgId}:${provider}`,
        metadata: { provider, source: "admin" },
      }, request.log);
      return reply.status(204).send();
    }
  );

  // DELETE /admin/organizations/:orgId/secrets/:provider
  app.delete<{ Params: { orgId: string; provider: string } }>(
    "/admin/organizations/:orgId/secrets/:provider",
    async (request, reply) => {
      const { orgId, provider } = request.params;
      if (!isValidProvider(provider)) {
        return reply.status(400).send({ error: "Provider inválido." });
      }
      const db = getAdminClient();
      const { data: deleted, error } = await db
        .from("organization_secrets")
        .delete()
        .eq("organization_id", orgId)
        .eq("provider", provider)
        .select("provider");
      if (error) return reply.status(500).send({ error: "Erro ao remover chave." });
      if (!deleted?.length) return reply.status(404).send({ error: "Chave não encontrada para este provider." });
      void fireAudit(db, {
        organization_id: orgId,
        user_id: request.user.id,
        action: "secret.deleted",
        entity_type: "secret",
        entity_id: `${orgId}:${provider}`,
        metadata: { provider, source: "admin" },
      }, request.log);
      return reply.status(204).send();
    }
  );

  // GET /admin/salomao-config
  app.get("/admin/salomao-config", async (request, reply) => {
    const db = getAdminClient();
    const { data, error } = await db
      .from("salomao_config")
      .select("system_prompt, updated_at")
      .limit(1)
      .single();
    if (error || !data) return reply.status(404).send({ error: "Configuração não encontrada." });
    return reply.send(data);
  });

  // PATCH /admin/salomao-config
  app.patch("/admin/salomao-config", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null | undefined;
    const systemPrompt = typeof body?.system_prompt === "string" ? body.system_prompt.trim() : "";
    if (!systemPrompt) return reply.status(400).send({ error: "system_prompt obrigatório e não pode ser vazio." });

    const db = getAdminClient();
    const { data, error } = await db
      .from("salomao_config")
      .update({ system_prompt: systemPrompt, updated_at: new Date().toISOString(), updated_by: request.user.id })
      .select("system_prompt, updated_at")
      .single();
    if (error) {
      request.log.error({ error }, "admin: failed to update salomao_config");
      return reply.status(500).send({ error: "Erro ao atualizar configuração." });
    }
    return reply.send(data);
  });

  // DELETE /admin/organizations/:orgId
  app.delete<{ Params: { orgId: string } }>(
    "/admin/organizations/:orgId",
    async (request, reply) => {
      const { orgId } = request.params;
      const db = getAdminClient();
      try {
        const { error } = await db.from("organizations").delete().eq("id", orgId);
        if (error) throw error;
        void fireAudit(
          db,
          {
            organization_id: null,
            user_id: request.user.id,
            action: "organization.deleted",
            entity_type: "organization",
            entity_id: orgId,
            metadata: { source: "admin_delete" },
          },
          request.log
        );
        return reply.status(204).send();
      } catch (err) {
        request.log.error({ err }, "admin: failed to delete organization");
        return reply.status(500).send({ error: "Erro ao deletar organização." });
      }
    }
  );
}
