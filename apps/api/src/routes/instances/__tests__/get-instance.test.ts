import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockGetInstanceByIdForUser, mockAuthMiddleware } = vi.hoisted(() => ({
  mockGetInstanceByIdForUser: vi.fn(),
  mockAuthMiddleware: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceByIdForUser: mockGetInstanceByIdForUser,
  getInstancesByOrganization: vi.fn(),
  createInstance: vi.fn(),
  updateInstance: vi.fn(),
  deleteInstance: vi.fn(),
  checkResourceLimit: vi.fn(),
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

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

import instanceRoutes from "../index";

const ORG_ID = "org-uuid-1";
const INST_ID = "inst-uuid-1";
const USER_ID = "user-uuid-1";

const INSTANCE_FIXTURE = {
  id: INST_ID,
  organization_id: ORG_ID,
  instance_name: "whatsapp-principal",
  status: "connected",
  phone_number: "+5511999999999",
  active_agent_id: null,
};

function buildApp(orgId = ORG_ID) {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: orgId, role: "admin" }],
    };
  });
  const app = Fastify({ logger: false });
  return app.register(instanceRoutes).then(() => app);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /instances/:instanceId ────────────────────────────────────────────────

describe("GET /instances/:instanceId", () => {
  it("membro da org → 200 com dados da instância", async () => {
    mockGetInstanceByIdForUser.mockResolvedValue(INSTANCE_FIXTURE);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/instances/${INST_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(INST_ID);
    expect(body.instance_name).toBe("whatsapp-principal");
    expect(body.organization_id).toBe(ORG_ID);
  });

  it("instância não encontrada → 404", async () => {
    mockGetInstanceByIdForUser.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/instances/${INST_ID}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("(S8) instância de outra org → 404 (query retorna null para org sem acesso)", async () => {
    mockGetInstanceByIdForUser.mockResolvedValue(null);
    const app = await buildApp("outra-org");
    const res = await app.inject({
      method: "GET",
      url: `/instances/${INST_ID}`,
    });
    expect(res.statusCode).toBe(404);
  });
});
