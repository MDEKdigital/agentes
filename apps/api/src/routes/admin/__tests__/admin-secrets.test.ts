import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockSuperAdminMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
  mockEncrypt,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockSuperAdminMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockEncrypt: vi.fn((v: string) => `encrypted:${v}`),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("../../../middleware/super-admin", () => ({
  superAdminMiddleware: mockSuperAdminMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getAllOrganizationsWithSubscriptions: vi.fn().mockResolvedValue([]),
  createManualSubscription: vi.fn(),
  updateSubscriptionAdmin: vi.fn(),
  cancelSubscriptionAdmin: vi.fn(),
  findOwnerInvitationByOrg: vi.fn(),
  getActivePlans: vi.fn().mockResolvedValue([]),
  renewInvitationExpiry: vi.fn(),
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../lib/email", () => ({
  sendWelcomeEmailApi: vi.fn(),
}));

vi.mock("../../../lib/crypto", () => ({
  encrypt: mockEncrypt,
}));

import adminRoutes from "../index";

const ORG_ID = "org-uuid-admin-1";
const USER_ID = "user-uuid-admin-1";

function makeDb(
  deleteData: Array<{ provider: string }> = [{ provider: "openai" }],
  deleteError: unknown = null
) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: deleteData, error: deleteError }),
          }),
        }),
      }),
    }),
  };
}

async function buildApp() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role: "owner" }] };
  });
  mockSuperAdminMiddleware.mockImplementation(async () => {});
  const app = Fastify({ logger: false });
  await app.register(adminRoutes);
  return app;
}

let mockDb: ReturnType<typeof makeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb = makeDb();
  mockGetAdminClient.mockReturnValue(mockDb);
  mockCreateAuditLog.mockResolvedValue({});
});

describe("Admin secrets — GET", () => {
  it("retorna lista de providers configurados com has_key: true", async () => {
    mockGetAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ provider: "openai" }], error: null }),
        }),
      }),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/admin/organizations/${ORG_ID}/secrets`,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ provider: "openai", has_key: true }]);
  });

  it("retorna 500 quando a consulta ao DB falha", async () => {
    mockGetAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
        }),
      }),
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/admin/organizations/${ORG_ID}/secrets`,
    });
    await app.close();
    expect(res.statusCode).toBe(500);
  });
});

describe("Admin secrets — PUT", () => {
  it("retorna 204, criptografa a chave e audita secret.upserted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/admin/organizations/${ORG_ID}/secrets/openai`,
      payload: { key: "sk-test-key-123" },
    });
    await app.close();
    expect(res.statusCode).toBe(204);
    expect(mockEncrypt).toHaveBeenCalledWith("sk-test-key-123");
    await vi.waitFor(() =>
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "secret.upserted",
          entity_type: "secret",
          organization_id: ORG_ID,
          user_id: USER_ID,
          metadata: expect.objectContaining({ provider: "openai", source: "admin" }),
        })
      )
    );
  });

  it("retorna 400 para provider inválido", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/admin/organizations/${ORG_ID}/secrets/invalid-provider`,
      payload: { key: "sk-test" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("Audit logs — admin secrets", () => {
  it("secret.deleted é auditado ao remover chave de API via rota admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/organizations/${ORG_ID}/secrets/openai`,
    });
    await app.close();
    expect(res.statusCode).toBe(204);
    expect(mockDb.from).toHaveBeenCalledWith("organization_secrets");
    await vi.waitFor(() =>
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "secret.deleted",
          entity_type: "secret",
          organization_id: ORG_ID,
          user_id: USER_ID,
          metadata: expect.objectContaining({ provider: "openai" }),
        })
      )
    );
  });

  it("secret.deleted NÃO é auditado quando provider não existe (0 linhas afetadas)", async () => {
    const emptyDb = makeDb([]);
    mockGetAdminClient.mockReturnValue(emptyDb);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/organizations/${ORG_ID}/secrets/openai`,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(emptyDb.from).toHaveBeenCalledWith("organization_secrets");
    expect(mockCreateAuditLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "secret.deleted" })
    );
  });
});
