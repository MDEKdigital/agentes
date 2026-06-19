import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateAuditLog } = vi.hoisted(() => ({
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  createAuditLog: mockCreateAuditLog,
}));

import { fireAudit, getAuditFailureCount, resetAuditFailureCount } from "../audit";

beforeEach(() => {
  vi.clearAllMocks();
  resetAuditFailureCount();
});

describe("R11: fireAudit — wrapper observável para falhas de audit", () => {
  it("R11: falha de audit incrementa o contador de falhas observável", async () => {
    mockCreateAuditLog.mockRejectedValue(new Error("DB write failed"));

    expect(getAuditFailureCount()).toBe(0);

    fireAudit({} as never, {
      action: "agent.updated",
      entity_type: "agent",
      entity_id: "agent-1",
      organization_id: "org-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAuditFailureCount()).toBe(1);
  });

  it("R11: audit bem-sucedido NÃO incrementa o contador", async () => {
    mockCreateAuditLog.mockResolvedValue({});

    fireAudit({} as never, {
      action: "secret.deleted",
      entity_type: "secret",
      entity_id: "org:openai",
      organization_id: "org-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAuditFailureCount()).toBe(0);
  });

  it("R11: múltiplas falhas incrementam o contador acumulativamente", async () => {
    mockCreateAuditLog.mockRejectedValue(new Error("timeout"));

    fireAudit({} as never, { action: "agent.updated", entity_type: "agent", entity_id: "1", organization_id: "org-1" });
    fireAudit({} as never, { action: "agent.deleted", entity_type: "agent", entity_id: "2", organization_id: "org-1" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAuditFailureCount()).toBe(2);
  });
});
