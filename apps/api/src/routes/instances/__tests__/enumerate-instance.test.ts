import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuthMiddleware,
  mockGetInstanceById,
  mockDeleteInstance,
  mockUpdateInstance,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetInstanceById: vi.fn(),
  mockDeleteInstance: vi.fn(),
  mockUpdateInstance: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceById: mockGetInstanceById,
  getInstancesByOrganization: vi.fn(),
  createInstance: vi.fn(),
  updateInstance: mockUpdateInstance,
  deleteInstance: mockDeleteInstance,
  checkResourceLimit: vi.fn(),
  getAgentById: vi.fn().mockResolvedValue(null),
  createAuditLog: vi.fn().mockResolvedValue({ id: "audit-uuid" }),
}));

vi.mock("../../../services/evolution.service", () => ({
  createInstance: vi.fn(),
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

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const INST_ID = "cccccccc-0000-0000-0000-000000000003";
const USER_ID = "dddddddd-0000-0000-0000-000000000004";

const INSTANCE_ORG_A = {
  id: INST_ID,
  organization_id: ORG_A,
  instance_name: "whatsapp-principal",
  status: "connected",
  phone_number: "+5511999999999",
  active_agent_id: null,
};

function buildAppAsOrgB() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_B, role: "owner" }],
    };
  });
  const app = Fastify({ logger: false });
  return app.register(instanceRoutes).then(() => app);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInstanceById.mockResolvedValue(INSTANCE_ORG_A);
  mockUpdateInstance.mockResolvedValue(INSTANCE_ORG_A);
  mockDeleteInstance.mockResolvedValue(undefined);
});

// ── S8: anti-enumeração ───────────────────────────────────────────────────────

describe("(S8) anti-enumeração: instância de outra org deve retornar 404", () => {
  it("GET /instances/:instanceId — org errada → 404", async () => {
    const app = await buildAppAsOrgB();
    const res = await app.inject({ method: "GET", url: `/instances/${INST_ID}` });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /instances/:instanceId — org errada → 404", async () => {
    const app = await buildAppAsOrgB();
    const res = await app.inject({ method: "DELETE", url: `/instances/${INST_ID}` });
    expect(res.statusCode).toBe(404);
    expect(mockDeleteInstance).not.toHaveBeenCalled();
  });

  it("GET /instances/:instanceId/settings — org errada → 404", async () => {
    const app = await buildAppAsOrgB();
    const res = await app.inject({ method: "GET", url: `/instances/${INST_ID}/settings` });
    expect(res.statusCode).toBe(404);
  });

  it("GET /instances/:instanceId/qrcode — org errada → 404", async () => {
    const app = await buildAppAsOrgB();
    const res = await app.inject({ method: "GET", url: `/instances/${INST_ID}/qrcode` });
    expect(res.statusCode).toBe(404);
  });

  it("instância realmente não encontrada → ainda 404 (sem regressão)", async () => {
    const err = Object.assign(new Error("not found"), { code: "PGRST116" });
    mockGetInstanceById.mockRejectedValue(err);
    const app = await buildAppAsOrgB();
    const res = await app.inject({ method: "GET", url: `/instances/${INST_ID}` });
    expect(res.statusCode).toBe(404);
  });
});
