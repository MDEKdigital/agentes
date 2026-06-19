import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

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

function makeDb() {
  const instancesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: [] }),
  };
  const orgsChain = {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "evolution_instances") return instancesChain;
      if (table === "organizations") return orgsChain;
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
  mockGetAdminClient.mockReturnValue(makeDb());
  mockCreateAuditLog.mockResolvedValue({});
});

describe("R1: DELETE /organizations/:organizationId — audit integrity", () => {
  it("R1: organization.deleted auditado com organization_id: null e entity_id preservado", async () => {
    const app = await buildApp("owner");

    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}`,
    });

    expect(res.statusCode).toBe(204);

    // Wait for fire-and-forget microtasks
    await Promise.resolve();

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "organization.deleted",
        organization_id: null,
        entity_id: ORG_ID,
      })
    );
  });

  it("R1: organization_id NÃO é passado como valor real (evita FK violation após delete)", async () => {
    const app = await buildApp("owner");
    await app.inject({ method: "DELETE", url: `/organizations/${ORG_ID}` });

    await Promise.resolve();

    const deletedAuditCalls = mockCreateAuditLog.mock.calls.filter(
      (args: unknown[]) => (args[1] as { action: string })?.action === "organization.deleted"
    );
    expect(deletedAuditCalls).toHaveLength(1);
    const [, params] = deletedAuditCalls[0] as [unknown, { organization_id: unknown }];
    expect(params.organization_id).toBeNull();
  });
});
