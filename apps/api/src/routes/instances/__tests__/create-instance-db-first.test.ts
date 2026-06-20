import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateInstanceRecord,
  mockUpdateInstance,
  mockCheckResourceLimit,
  mockCreateEvolutionInstance,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateInstanceRecord: vi.fn(),
  mockUpdateInstance: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
  mockCreateEvolutionInstance: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getInstancesByOrganization: vi.fn(),
  getInstanceByIdForUser: vi.fn(),
  createInstance: mockCreateInstanceRecord,
  createInstanceAtomically: mockCreateInstanceRecord,
  updateInstance: mockUpdateInstance,
  deleteInstance: vi.fn(),
  checkResourceLimit: mockCheckResourceLimit,
  getAgentById: vi.fn(),
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../services/evolution.service", () => ({
  createInstance: mockCreateEvolutionInstance,
  getInstanceStatus: vi.fn(),
  getInstanceQrCode: vi.fn(),
  deleteInstance: vi.fn(),
  logoutInstance: vi.fn(),
  fetchProfile: vi.fn(),
  fetchInstanceDetails: vi.fn(),
  updateProfileName: vi.fn(),
  updateProfileStatus: vi.fn(),
  updateProfilePicture: vi.fn(),
  getInstanceSettings: vi.fn(),
  setInstanceSettings: vi.fn(),
  getPrivacySettings: vi.fn(),
  updatePrivacySettings: vi.fn(),
  restartInstance: vi.fn(),
  requestPairingCode: vi.fn(),
}));

import instanceRoutes from "../index";

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

const pendingRecord = {
  id: "inst-uuid-1",
  organization_id: ORG_ID,
  instance_name: "whatsapp-principal",
  instance_id: "whatsapp-principal",
  status: "connecting" as const,
  phone_number: null,
  webhook_url: "http://api/webhooks/evolution",
  active_agent_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const finalRecord = { ...pendingRecord, status: "disconnected" as const };

async function buildApp() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role: "admin" }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(instanceRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 0, max: 3 });
  mockCreateInstanceRecord.mockResolvedValue(pendingRecord);
  mockUpdateInstance.mockResolvedValue(finalRecord);
  mockCreateEvolutionInstance.mockResolvedValue({ instance: { instanceName: "whatsapp-principal" } });
  mockCreateAuditLog.mockResolvedValue({});
  process.env.PUBLIC_API_URL = "http://api";
});

// ── C5 tests ──────────────────────────────────────────────────────────────────

describe("POST /organizations/:organizationId/instances — DB-first provisioning (C5)", () => {
  it("C5: createInstanceRecord é chamado ANTES de createEvolutionInstance", async () => {
    const callOrder: string[] = [];
    mockCreateInstanceRecord.mockImplementation(async () => {
      callOrder.push("createInstanceRecord");
      return pendingRecord;
    });
    mockCreateEvolutionInstance.mockImplementation(async () => {
      callOrder.push("createEvolutionInstance");
      return { instance: { instanceName: "whatsapp-principal" } };
    });

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(callOrder).toEqual(["createInstanceRecord", "createEvolutionInstance"]);
  });

  it("C5: se createInstanceRecord falha, createEvolutionInstance NÃO é chamado", async () => {
    mockCreateInstanceRecord.mockRejectedValue(new Error("DB constraint violation"));

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(mockCreateEvolutionInstance).not.toHaveBeenCalled();
    expect(res.statusCode).not.toBe(201);
  });

  it("C5: se createEvolutionInstance falha, registro local permanece rastreável (não deletado)", async () => {
    mockCreateEvolutionInstance.mockRejectedValue(new Error("Evolution API unavailable"));

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    // Registro local foi criado (DB-first)
    expect(mockCreateInstanceRecord).toHaveBeenCalledOnce();
    // Resposta reflete falha real — não é 201
    expect(res.statusCode).not.toBe(201);
    // Deve retornar 502 (falha no provedor externo)
    expect(res.statusCode).toBe(502);
  });

  it("C5: registro local criado com status 'connecting' (estado de provisionamento pendente)", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    // C7: createInstanceAtomically (aliased to mockCreateInstanceRecord) receives orgId as 2nd arg
    // and instance data as 3rd arg — both are now routed through the atomic helper
    expect(mockCreateInstanceRecord).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ status: "connecting" })
    );
  });

  it("C5: no caminho de sucesso, updateInstance atualiza o registro para estado final 'disconnected'", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(res.statusCode).toBe(201);
    expect(mockUpdateInstance).toHaveBeenCalledWith(
      expect.anything(),
      pendingRecord.id,
      expect.objectContaining({ status: "disconnected" }),
      ORG_ID
    );
  });

  it("C5: resposta 201 retorna o registro final (após updateInstance), não o pendingRecord", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("disconnected");
  });

  it("C5: falha no createEvolutionInstance NÃO deve chamar updateInstance (sem falso sucesso)", async () => {
    mockCreateEvolutionInstance.mockRejectedValue(new Error("timeout"));

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(mockUpdateInstance).not.toHaveBeenCalledWith(
      expect.anything(),
      pendingRecord.id,
      expect.objectContaining({ status: "disconnected" }),
      ORG_ID
    );
  });

  it("C5: caminho de sucesso completo — ordem correta: createInstanceRecord → Evolution → updateInstance → audit", async () => {
    const callOrder: string[] = [];
    mockCreateInstanceRecord.mockImplementation(async () => {
      callOrder.push("createInstanceRecord");
      return pendingRecord;
    });
    mockCreateEvolutionInstance.mockImplementation(async () => {
      callOrder.push("createEvolutionInstance");
      return { instance: { instanceName: "whatsapp-principal" } };
    });
    mockUpdateInstance.mockImplementation(async () => {
      callOrder.push("updateInstance");
      return finalRecord;
    });
    mockCreateAuditLog.mockImplementation(async () => {
      callOrder.push("createAuditLog");
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(res.statusCode).toBe(201);
    expect(callOrder).toEqual([
      "createInstanceRecord",
      "createEvolutionInstance",
      "updateInstance",
      "createAuditLog",
    ]);
  });
});
