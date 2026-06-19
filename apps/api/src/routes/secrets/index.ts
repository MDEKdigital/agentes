import type { FastifyInstance } from "fastify";
import { getAdminClient, createAuditLog } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { encrypt } from "../../lib/crypto";

const ALLOWED_PROVIDERS = ["openai", "anthropic", "google"] as const;

export default async function secretsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Returns which providers are configured — does NOT return key values
  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/secrets",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return reply.status(403).send({ error: "Acesso negado" });
      }

      const db = getAdminClient();
      const { data } = await db
        .from("organization_secrets")
        .select("provider")
        .eq("organization_id", organizationId);

      return (data || []).map((s) => ({ provider: s.provider, has_key: true }));
    }
  );

  app.put<{
    Params: { organizationId: string; provider: string };
    Body: { key: string };
  }>(
    "/organizations/:organizationId/secrets/:provider",
    async (request, reply) => {
      const { organizationId, provider } = request.params;
      const { key } = request.body;

      if (!key || typeof key !== "string" || !key.trim()) {
        return reply.status(400).send({ error: "A chave é obrigatória" });
      }

      if (!ALLOWED_PROVIDERS.includes(provider as (typeof ALLOWED_PROVIDERS)[number])) {
        return reply.status(400).send({ error: `Provider inválido. Permitidos: ${ALLOWED_PROVIDERS.join(", ")}` });
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return reply.status(403).send({ error: "Acesso negado" });
      }

      const db = getAdminClient();
      const { error } = await db.from("organization_secrets").upsert(
        { organization_id: organizationId, provider, encrypted_key: encrypt(key.trim()) },
        { onConflict: "organization_id,provider" }
      );

      if (error) return reply.status(500).send({ error: "Erro interno ao processar chave" });

      createAuditLog(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "secret.upserted",
        entity_type: "secret",
        entity_id: `${organizationId}:${provider}`,
        metadata: { provider },
      }).catch((err) => request.log.error({ err }, "audit: secret.upserted failed"));

      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { organizationId: string; provider: string } }>(
    "/organizations/:organizationId/secrets/:provider",
    async (request, reply) => {
      const { organizationId, provider } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return reply.status(403).send({ error: "Acesso negado" });
      }

      const db = getAdminClient();
      const { data: deleted, error } = await db
        .from("organization_secrets")
        .delete()
        .eq("organization_id", organizationId)
        .eq("provider", provider)
        .select("provider");

      if (error) return reply.status(500).send({ error: "Erro interno ao processar chave" });

      // R8: only audit when a row was actually deleted
      if (deleted && deleted.length > 0) {
        createAuditLog(db, {
          organization_id: organizationId,
          user_id: request.user.id,
          action: "secret.deleted",
          entity_type: "secret",
          entity_id: `${organizationId}:${provider}`,
          metadata: { provider },
        }).catch((err) => request.log.error({ err }, "audit: secret.deleted failed"));
      }

      return reply.status(204).send();
    }
  );
}
