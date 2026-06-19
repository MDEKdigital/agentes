import type { getAdminClient } from "@aula-agente/database";
import { createAuditLog } from "@aula-agente/database";

type DbClient = ReturnType<typeof getAdminClient>;
type AuditParams = Parameters<typeof createAuditLog>[1];

let _auditFailureCount = 0;

export function getAuditFailureCount(): number {
  return _auditFailureCount;
}

export function resetAuditFailureCount(): void {
  _auditFailureCount = 0;
}

export function fireAudit(client: DbClient, params: AuditParams): void {
  createAuditLog(client, params).catch((err) => {
    _auditFailureCount++;
    console.error(`[audit] ${params.action} failed:`, err);
  });
}
