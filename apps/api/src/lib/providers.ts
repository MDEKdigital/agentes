import { LLM_PROVIDERS, type LLMProvider } from "@aula-agente/shared";
import type { getAdminClient } from "@aula-agente/database";
import { encrypt } from "./crypto";

export function isValidProvider(p: string): p is LLMProvider {
  return LLM_PROVIDERS.includes(p as LLMProvider);
}

export function upsertOrgSecret(
  db: ReturnType<typeof getAdminClient>,
  orgId: string,
  provider: LLMProvider,
  rawKey: string
) {
  return db.from("organization_secrets").upsert(
    { organization_id: orgId, provider, encrypted_key: encrypt(rawKey) },
    { onConflict: "organization_id,provider" }
  );
}
