import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetInstanceById,
  mockCreateAuditLog,
  mockRestartInstance,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(async (_request: any) => {}),
  mockGetInstanceById: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockRestartInstance: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceById: mockGetInstanceById,
  getInstancesByOrganization: vi.fn(),
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  deleteInstance: vi.fn(),
  checkResourceLimit: vi.fn().mockResolvedValue({ allowed: true, current: 0, max: 3 }),
  getAgentById: vi.fn().mockResolvedValue({ id: "agent-1" }),
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../services/evolution.service", () => ({
  createInstance: vi.fn().mockResolvedValue({ instance: { instanceName: "test-instance" } }),
  getInstanceStatus: vi.fn(),
  getInstanceQrCode: vi.fn(),
  deleteInstance: vi.fn().mockResolvedValue({}),
  logoutInstance: vi.fn().mockResolvedValue({}),
  fetchProfile: vi.fn(),
  fetchInstanceDetails: vi.fn(),
  updateProfileName: vi.fn().mockResolvedValue({}),
  updateProfileStatus: vi.fn().mockResolvedValue({}),
  updateProfilePicture: vi.fn().mockResolvedValue({}),
  getInstanceSettings: vi.fn(),
  setInstanceSettings: vi.fn().mockResolvedValue({}),
  getPrivacySettings: vi.fn(),
  updatePrivacySettings: vi.fn().mockResolvedValue({}),
  restartInstance: mockRestartInstance,
  requestPairingCode: vi.fn(),
}));

import instanceRoutes from "../index";

const ORG_ID = "org-uuid-1";
const INST_ID = "inst-uuid-1";
const USER_ID = "user-uuid-1";

const mockInstance = {
  id: INST_ID,
  organization_id: ORG_ID,
  instance_name: "test-instance",
  status: "connected",
  phone_number: "+5511999999999",
};

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role }] };
  });
  const app = Fastify({ logger: false });
  await app.register(instanceRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInstanceById.mockResolvedValue(mockInstance);
  mockCreateAuditLog.mockResolvedValue({});
  mockRestartInstance.mockResolvedValue({});
});

describe("R2: POST /instances/:instanceId/restart — sem falso positivo de audit", () => {
  it("R2: Evolution API falha → retorna 502 (não 200)", async () => {
    mockRestartInstance.mockRejectedValue(new Error("Evolution API unavailable"));
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/instances/${INST_ID}/restart`,
    });

    expect(res.statusCode).toBe(502);
  });

  it("R2: Evolution API falha → NÃO audita instance.restarted", async () => {
    mockRestartInstance.mockRejectedValue(new Error("Evolution API unavailable"));
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: `/instances/${INST_ID}/restart`,
    });

    await Promise.resolve();

    const restartedCalls = mockCreateAuditLog.mock.calls.filter(
      (args: unknown[]) => (args[1] as { action: string })?.action === "instance.restarted"
    );
    expect(restartedCalls).toHaveLength(0);
  });

  it("R2: Evolution API sucesso → 200 E audita instance.restarted", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/instances/${INST_ID}/restart`,
    });

    await Promise.resolve();

    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "instance.restarted" })
    );
  });
});
