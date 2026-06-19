import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuthMiddleware,
  mockGetInstanceById,
  mockGetAgentById,
  mockUpdateInstance,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetInstanceById: vi.fn(),
  mockGetAgentById: vi.fn(),
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
  deleteInstance: vi.fn(),
  checkResourceLimit: vi.fn(),
  getAgentById: mockGetAgentById,
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
const AGENT_ORG_A = "eeeeeeee-0000-0000-0000-000000000005";
const AGENT_ORG_B = "ffffffff-0000-0000-0000-000000000006";

const INSTANCE_ORG_A = {
  id: INST_ID,
  organization_id: ORG_A,
  instance_name: "whatsapp-principal",
  status: "connected",
  phone_number: "+5511999999999",
  active_agent_id: null,
};

const AGENT_FIXTURE = {
  id: AGENT_ORG_A,
  organization_id: ORG_A,
  name: "Agente da Org A",
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_A, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(instanceRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInstanceById.mockResolvedValue(INSTANCE_ORG_A);
  mockGetAgentById.mockResolvedValue(AGENT_FIXTURE);
  mockUpdateInstance.mockResolvedValue({ ...INSTANCE_ORG_A, active_agent_id: AGENT_ORG_A });
});

// ── PATCH /instances/:instanceId ──────────────────────────────────────────────

describe("PATCH /instances/:instanceId", () => {
  it("atualiza instância com agente da mesma org → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}`,
      payload: { active_agent_id: AGENT_ORG_A },
    });

    expect(res.statusCode).toBe(200);
    expect(mockUpdateInstance).toHaveBeenCalledOnce();
  });

  it("remove agente (active_agent_id: null) → 200 sem validar agente", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}`,
      payload: { active_agent_id: null },
    });

    expect(res.statusCode).toBe(200);
    // getAgentById should NOT be called when unsetting the agent
    expect(mockGetAgentById).not.toHaveBeenCalled();
    expect(mockUpdateInstance).toHaveBeenCalledOnce();
  });

  it("(S7): active_agent_id de outra org → 403 sem chamar updateInstance", async () => {
    // Agent from Org B does not belong to Org A
    mockGetAgentById.mockResolvedValue(null); // getAgentById(db, AGENT_ORG_B, ORG_A) → null

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}`,
      payload: { active_agent_id: AGENT_ORG_B },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("Agente não pertence a esta organização");
    // Critical: updateInstance must NOT have been called
    expect(mockUpdateInstance).not.toHaveBeenCalled();
  });

  it("instância não encontrada → 404", async () => {
    const err = Object.assign(new Error("not found"), { code: "PGRST116" });
    mockGetInstanceById.mockRejectedValue(err);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}`,
      payload: { active_agent_id: AGENT_ORG_A },
    });

    expect(res.statusCode).toBe(404);
    expect(mockUpdateInstance).not.toHaveBeenCalled();
  });

  it("(S8): usuário não é membro da org da instância → 404 (anti-enumeração)", async () => {
    mockAuthMiddleware.mockImplementation(async (request: any) => {
      request.user = {
        id: USER_ID,
        memberships: [{ organization_id: ORG_B, role: "admin" }],
      };
    });
    const app = Fastify({ logger: false });
    await app.register(instanceRoutes);

    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}`,
      payload: { active_agent_id: AGENT_ORG_A },
    });

    expect(res.statusCode).toBe(404);
    expect(mockUpdateInstance).not.toHaveBeenCalled();
  });

  it("role agent → 403", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}`,
      payload: { active_agent_id: AGENT_ORG_A },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateInstance).not.toHaveBeenCalled();
  });
});
