import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockAuthMiddleware, mockSuperAdminMiddleware, mockGetAdminClient } = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockSuperAdminMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));
vi.mock("../../../middleware/super-admin", () => ({ superAdminMiddleware: mockSuperAdminMiddleware }));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getAllOrganizationsWithSubscriptions: vi.fn().mockResolvedValue([]),
  createManualSubscription: vi.fn(),
  updateSubscriptionAdmin: vi.fn(),
  cancelSubscriptionAdmin: vi.fn(),
  findOwnerInvitationByOrg: vi.fn(),
  getActivePlans: vi.fn().mockResolvedValue([]),
  renewInvitationExpiry: vi.fn(),
  createAuditLog: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../lib/email", () => ({ sendWelcomeEmailApi: vi.fn() }));
vi.mock("../../../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("../../../lib/crypto", () => ({ encrypt: vi.fn((v: string) => v), decrypt: vi.fn((v: string) => v) }));

import adminRoutes from "../index";

function buildApp() {
  const app = Fastify();
  mockAuthMiddleware.mockImplementation(async (req: { user: { id: string; memberships: never[] } }) => {
    req.user = { id: "super-1", memberships: [] };
  });
  mockSuperAdminMiddleware.mockImplementation(async () => {});
  app.register(adminRoutes);
  return app;
}

describe("GET /admin/salomao-config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns system_prompt from DB", async () => {
    mockGetAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({ limit: () => ({ single: async () => ({ data: { system_prompt: "prompt test", updated_at: "2026-01-01" }, error: null }) }) }),
        update: vi.fn(),
      }),
    });

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/admin/salomao-config" });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.system_prompt).toBe("prompt test");
  });
});

describe("PATCH /admin/salomao-config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects empty system_prompt", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/salomao-config",
      payload: { system_prompt: "   " },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("updates system_prompt and returns updated row", async () => {
    const updatedRow = { system_prompt: "novo prompt", updated_at: "2026-06-28" };
    mockGetAdminClient.mockReturnValue({
      from: () => ({
        update: () => ({ select: () => ({ single: async () => ({ data: updatedRow, error: null }) }) }),
      }),
    });

    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/salomao-config",
      payload: { system_prompt: "novo prompt" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).system_prompt).toBe("novo prompt");
  });
});
