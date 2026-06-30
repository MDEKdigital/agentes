import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
  mockEncrypt,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockEncrypt: vi.fn((v: string) => `encrypted:${v}`),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../lib/crypto", () => ({
  encrypt: mockEncrypt,
}));

import secretsRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

function makeDb(
  upsertError: unknown = null,
  selectData: Array<{ provider: string }> = []
) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: selectData, error: null }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: upsertError }),
      // defensive mock — no DELETE handler on this route yet; prevents TypeError if one is added
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }),
  };
}

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role }] };
  });
  const app = Fastify({ logger: false });
  await app.register(secretsRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockCreateAuditLog.mockResolvedValue({});
});

describe("Audit logs — secrets", () => {
  it("secret.upserted é auditado ao salvar chave de API", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/organizations/${ORG_ID}/secrets/openai`,
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
          metadata: expect.objectContaining({ provider: "openai" }),
        })
      )
    );
    expect(mockCreateAuditLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: expect.objectContaining({ key: expect.anything() }) })
    );
  });

});

describe("GET /organizations/:orgId/secrets", () => {
  it("retorna lista de providers configurados com has_key: true", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null, [{ provider: "openai" }]));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/organizations/${ORG_ID}/secrets` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ provider: "openai", has_key: true }]);
  });

  it("retorna 403 para membro sem role owner/admin", async () => {
    const app = await buildApp("member");
    const res = await app.inject({ method: "GET", url: `/organizations/${ORG_ID}/secrets` });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PUT /organizations/:orgId/secrets/:provider — validação", () => {
  it("retorna 400 para provider inválido", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/organizations/${ORG_ID}/secrets/invalid-provider`,
      payload: { key: "sk-test" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("retorna 403 para membro sem role owner/admin com inputs válidos", async () => {
    const app = await buildApp("member");
    const res = await app.inject({
      method: "PUT",
      url: `/organizations/${ORG_ID}/secrets/openai`,
      payload: { key: "sk-valid-key" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
