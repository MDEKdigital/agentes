import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuditLog } from "../audit";
import type { CreateAuditLogParams } from "@aula-agente/shared";

// ── mock Supabase client ──────────────────────────────────────────────────────

function makeClient(overrides?: { error?: { message: string; code?: string } }) {
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: overrides?.error ? null : { id: "audit-uuid", created_at: new Date().toISOString() },
        error: overrides?.error ?? null,
      }),
    }),
  });

  return {
    from: vi.fn().mockReturnValue({ insert }),
    _insert: insert,
  };
}

const BASE_PARAMS: CreateAuditLogParams = {
  organization_id: "org-uuid-1",
  user_id: "user-uuid-1",
  action: "agent.created",
  entity_type: "agent",
  entity_id: "agent-uuid-1",
  metadata: { name: "Meu Agente" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAuditLog", () => {
  it("T1: insere na tabela audit_logs com todos os campos", async () => {
    const client = makeClient();
    await createAuditLog(client as any, BASE_PARAMS);

    expect(client.from).toHaveBeenCalledWith("audit_logs");
    expect(client._insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-uuid-1",
        user_id: "user-uuid-1",
        action: "agent.created",
        entity_type: "agent",
        entity_id: "agent-uuid-1",
        metadata: { name: "Meu Agente" },
      })
    );
  });

  it("T2: usa null para campos opcionais ausentes", async () => {
    const client = makeClient();
    await createAuditLog(client as any, {
      action: "billing.event_received",
      entity_type: "billing_event",
    });

    expect(client._insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: null,
        user_id: null,
        entity_id: null,
        metadata: {},
      })
    );
  });

  it("T3: retorna o registro inserido", async () => {
    const client = makeClient();
    const result = await createAuditLog(client as any, BASE_PARAMS);
    expect(result).toMatchObject({ id: "audit-uuid" });
  });

  it("T4: lança erro quando Supabase retorna error", async () => {
    const client = makeClient({ error: { message: "db failure", code: "23505" } });
    await expect(createAuditLog(client as any, BASE_PARAMS)).rejects.toThrow("db failure");
  });

  it("T5: aceita organization_id nulo (eventos de sistema sem org)", async () => {
    const client = makeClient();
    await expect(
      createAuditLog(client as any, {
        organization_id: null,
        user_id: null,
        action: "organization.created",
        entity_type: "organization",
        entity_id: "org-uuid-new",
        metadata: { gateway: "hotmart" },
      })
    ).resolves.not.toThrow();
  });

  it("T6: metadata padrão é {} quando não fornecido", async () => {
    const client = makeClient();
    await createAuditLog(client as any, {
      action: "agent.deleted",
      entity_type: "agent",
      entity_id: "agent-uuid-1",
      organization_id: "org-1",
      user_id: "user-1",
    });

    expect(client._insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} })
    );
  });
});
