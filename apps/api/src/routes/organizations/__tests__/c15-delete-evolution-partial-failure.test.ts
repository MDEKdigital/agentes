import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
  mockDeleteInstance,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(async (_request: any) => {}),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockDeleteInstance: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getOrganizationById: vi.fn(),
  getUserOrganizations: vi.fn().mockResolvedValue([]),
  isSlugAvailableForOrg: vi.fn().mockResolvedValue(true),
  completeOrganizationOnboarding: vi.fn(),
  updateOrganizationName: vi.fn(),
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../services/evolution.service", () => ({
  deleteInstance: mockDeleteInstance,
}));

import organizationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

// ── DB builder ────────────────────────────────────────────────────────────────

function makeDb(instances: { instance_name: string }[], deleteError: unknown = null) {
  const mockDeleteEq = vi.fn().mockResolvedValue({ error: deleteError });
  const mockDeleteChain = { delete: vi.fn().mockReturnValue({ eq: mockDeleteEq }) };

  return {
    _deleteEq: mockDeleteEq,
    from: vi.fn((table: string) => {
      if (table === "evolution_instances") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: instances }),
        };
      }
      if (table === "organizations") return mockDeleteChain;
      return {};
    }),
  };
}

async function buildApp(role = "owner") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(organizationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAuditLog.mockResolvedValue({});
  mockDeleteInstance.mockResolvedValue({});
});

// ─── C15 tests ────────────────────────────────────────────────────────────────

describe("C15: organization delete aborts when Evolution instance cleanup fails", () => {
  it("C15: sem instâncias → delete normal acontece → 204", async () => {
    const db = makeDb([]);
    mockGetAdminClient.mockReturnValue(db);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    expect(res.statusCode).toBe(204);
    expect(db._deleteEq).toHaveBeenCalled();
  });

  it("C15: sem instâncias → audit organization.deleted dispara", async () => {
    mockGetAdminClient.mockReturnValue(makeDb([]));

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });
    await Promise.resolve();

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "organization.deleted", entity_id: ORG_ID })
    );
  });

  it("C15: todas as instâncias deletadas com sucesso → delete local acontece → 204", async () => {
    const instances = [
      { instance_name: "inst-a" },
      { instance_name: "inst-b" },
    ];
    const db = makeDb(instances);
    mockGetAdminClient.mockReturnValue(db);
    mockDeleteInstance.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteInstance).toHaveBeenCalledTimes(2);
    expect(db._deleteEq).toHaveBeenCalled();
  });

  it("C15: todas as instâncias deletadas com sucesso → audit dispara", async () => {
    const instances = [{ instance_name: "inst-ok" }];
    mockGetAdminClient.mockReturnValue(makeDb(instances));
    mockDeleteInstance.mockResolvedValue({});

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });
    await Promise.resolve();

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "organization.deleted" })
    );
  });

  it("C15: uma instância falha na Evolution → delete local NÃO acontece", async () => {
    const instances = [{ instance_name: "inst-fail" }];
    const db = makeDb(instances);
    mockGetAdminClient.mockReturnValue(db);
    mockDeleteInstance.mockRejectedValue(new Error("Evolution timeout"));

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    expect(db._deleteEq).not.toHaveBeenCalled();
  });

  it("C15: uma instância falha na Evolution → resposta reflete falha (não 204)", async () => {
    mockGetAdminClient.mockReturnValue(makeDb([{ instance_name: "inst-fail" }]));
    mockDeleteInstance.mockRejectedValue(new Error("Evolution timeout"));

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    expect(res.statusCode).not.toBe(204);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  it("C15: uma instância falha na Evolution → audit organization.deleted NÃO dispara", async () => {
    mockGetAdminClient.mockReturnValue(makeDb([{ instance_name: "inst-fail" }]));
    mockDeleteInstance.mockRejectedValue(new Error("Evolution timeout"));

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });
    await Promise.resolve();

    const deletedAuditCalls = mockCreateAuditLog.mock.calls.filter(
      (args) => (args[1] as { action: string })?.action === "organization.deleted"
    );
    expect(deletedAuditCalls).toHaveLength(0);
  });

  it("C15: falha parcial (2 instâncias, 1 falha) → delete local NÃO acontece", async () => {
    const instances = [
      { instance_name: "inst-ok" },
      { instance_name: "inst-fail" },
    ];
    const db = makeDb(instances);
    mockGetAdminClient.mockReturnValue(db);
    mockDeleteInstance
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Evolution error"));

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    expect(db._deleteEq).not.toHaveBeenCalled();
  });

  it("C15: falha parcial → resposta de erro (não 204)", async () => {
    const instances = [
      { instance_name: "inst-ok" },
      { instance_name: "inst-fail" },
    ];
    mockGetAdminClient.mockReturnValue(makeDb(instances));
    mockDeleteInstance
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Evolution error"));

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    expect(res.statusCode).not.toBe(204);
  });

  it("C15: Promise.allSettled não pode mascarar falha como sucesso final", async () => {
    // Verify the implementation checks for failures from allSettled results
    const instances = [{ instance_name: "inst-settled-fail" }];
    const db = makeDb(instances);
    mockGetAdminClient.mockReturnValue(db);
    mockDeleteInstance.mockRejectedValue(new Error("settled but failed"));

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    // If allSettled were silently ignored, the org delete would proceed → 204
    // After fix: the failed result must abort the flow → NOT 204
    expect(res.statusCode).not.toBe(204);
    expect(db._deleteEq).not.toHaveBeenCalled();
  });
});
