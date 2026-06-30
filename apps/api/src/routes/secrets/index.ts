import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { LLM_PROVIDERS } from "@aula-agente/shared";
import { authMiddleware } from "../../middleware/auth";
import { fireAudit } from "../../lib/audit";
import { isValidProvider, upsertOrgSecret } from "../../lib/providers";

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

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return reply.status(403).send({ error: "Acesso negado" });
      }

      if (!key || typeof key !== "string" || !key.trim()) {
        return reply.status(400).send({ error: "A chave é obrigatória" });
      }

      if (!isValidProvider(provider)) {
        return reply.status(400).send({ error: `Provider inválido. Permitidos: ${LLM_PROVIDERS.join(", ")}` });
      }

      const db = getAdminClient();
      const { error } = await upsertOrgSecret(db, organizationId, provider, key.trim());

      if (error) return reply.status(500).send({ error: "Erro interno ao processar chave" });

      void fireAudit(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "secret.upserted",
        entity_type: "secret",
        entity_id: `${organizationId}:${provider}`,
        metadata: { provider },
      }, request.log);

      return reply.status(204).send();
    }
  );

}
