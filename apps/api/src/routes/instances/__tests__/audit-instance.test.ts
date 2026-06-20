import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetInstanceByIdForUser,
  mockCreateAuditLog,
  mockCreateInstanceRecord,
  mockUpdateInstance,
  mockDeleteInstance,
  mockCheckResourceLimit,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetInstanceByIdForUser: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockCreateInstanceRecord: vi.fn(),
  mockUpdateInstance: vi.fn(),
  mockDeleteInstance: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceByIdForUser: mockGetInstanceByIdForUser,
  getInstancesByOrganization: vi.fn(),
  createInstance: mockCreateInstanceRecord,
  updateInstance: mockUpdateInstance,
  deleteInstance: mockDeleteInstance,
  checkResourceLimit: mockCheckResourceLimit,
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
  restartInstance: vi.fn().mockResolvedValue({}),
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
  mockGetInstanceByIdForUser.mockResolvedValue(mockInstance);
  mockUpdateInstance.mockResolvedValue(mockInstance);
  mockDeleteInstance.mockResolvedValue(undefined);
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 0, max: 3 });
  mockCreateAuditLog.mockResolvedValue({});
  mockCreateInstanceRecord.mockResolvedValue({ ...mockInstance, id: INST_ID });
});

describe("Audit logs — instances", () => {
  it("instance.created é auditado ao criar instância", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/instances`,
      payload: { instance_name: "test-instance" },
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.created",
        entity_type: "instance",
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("instance.updated é auditado ao atualizar instância", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}`,
      payload: { active_agent_id: null },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.updated",
        entity_type: "instance",
        entity_id: INST_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("instance.deleted é auditado ao deletar instância", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "DELETE",
      url: `/instances/${INST_ID}`,
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.deleted",
        entity_type: "instance",
        entity_id: INST_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("instance.restarted é auditado ao reiniciar instância", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/instances/${INST_ID}/restart`,
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.restarted",
        entity_type: "instance",
        entity_id: INST_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("instance.logged_out é auditado ao desconectar instância", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/instances/${INST_ID}/logout`,
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.logged_out",
        entity_type: "instance",
        entity_id: INST_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("instance.settings_updated é auditado ao atualizar configurações", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/instances/${INST_ID}/settings`,
      payload: { rejectCall: true },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.settings_updated",
        entity_type: "instance",
        entity_id: INST_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("instance.privacy_updated é auditado ao atualizar privacidade", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/instances/${INST_ID}/privacy`,
      payload: { readreceipts: "all" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.privacy_updated",
        entity_type: "instance",
        entity_id: INST_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("instance.profile_updated é auditado ao atualizar perfil", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/instances/${INST_ID}/profile`,
      payload: { name: "Novo Nome" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "instance.profile_updated",
        entity_type: "instance",
        entity_id: INST_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });
});
