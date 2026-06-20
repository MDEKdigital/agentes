import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateInstanceRecord,
  mockUpdateInstance,
  mockCheckResourceLimit,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateInstanceRecord: vi.fn(),
  mockUpdateInstance: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getInstancesByOrganization: vi.fn(),
  getInstanceByIdForUser: vi.fn(),
  createInstance: mockCreateInstanceRecord,
  createInstanceAtomically: mockCreateInstanceRecord, // same mock — both shapes
  updateInstance: mockUpdateInstance,
  deleteInstance: vi.fn(),
  checkResourceLimit: mockCheckResourceLimit,
  getAgentById: vi.fn(),
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../services/evolution.service", () => ({
  createInstance: vi.fn().mockResolvedValue({ instance: { instanceName: "test-instance" } }),
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

// ── helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(instanceRoutes);
  return app;
}

const mockCreatedInstance = {
  id: "inst-uuid-1",
  organization_id: ORG_ID,
  instance_name: "whatsapp-principal",
  status: "disconnected",
  phone_number: null,
};

// ── default state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockCreateInstanceRecord.mockResolvedValue(mockCreatedInstance);
  mockUpdateInstance.mockResolvedValue(mockCreatedInstance);
  // Default: under limit
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 1, max: 3 });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /organizations/:organizationId/instances — plan limit enforcement", () => {
  it("cenário 1: dentro do limite → cria instância → 201", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateInstanceRecord).toHaveBeenCalled();
  });

  it("cenário 2: limite atingido → NÃO cria instância → 403", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-extra" },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.limit_exceeded).toBe(true);
    expect(mockCreateInstanceRecord).not.toHaveBeenCalled();
  });

  it("cenário 3: sem assinatura (max: null) → cria instância → 201", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 5, max: null });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-principal" },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateInstanceRecord).toHaveBeenCalled();
  });

  it("cenário 4: limite atingido → checkResourceLimit chamado com 'instances'", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "whatsapp-extra" },
    });

    expect(mockCheckResourceLimit).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      "instances"
    );
  });
});
