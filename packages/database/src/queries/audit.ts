import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLog, CreateAuditLogParams } from "@aula-agente/shared";

export async function createAuditLog(
  client: SupabaseClient,
  params: CreateAuditLogParams
): Promise<AuditLog> {
  const { data, error } = await client
    .from("audit_logs")
    .insert({
      organization_id: params.organization_id ?? null,
      user_id: params.user_id ?? null,
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id ?? null,
      metadata: params.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw error;
  return data as AuditLog;
}
