import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../lib/crypto", () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
}));

import secretsRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

function makeDb(
  deleteData: Array<{ provider: string }> = [{ provider: "openai" }],
  upsertError: unknown = null,
  deleteError: unknown = null
) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: upsertError }),
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
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "secret.upserted",
        entity_type: "secret",
        organization_id: ORG_ID,
        user_id: USER_ID,
        metadata: expect.objectContaining({ provider: "openai" }),
      })
    );
    expect(mockCreateAuditLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: expect.objectContaining({ key: expect.anything() }) })
    );
  });

  it("secret.deleted é auditado ao remover chave de API", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/secrets/openai`,
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "secret.deleted",
        entity_type: "secret",
        organization_id: ORG_ID,
        user_id: USER_ID,
        metadata: expect.objectContaining({ provider: "openai" }),
      })
    );
  });

  // ── R8: secret fantasma — sem audit quando 0 linhas afetadas ────────────────

  it("R8: DELETE de secret inexistente (0 linhas afetadas) → NÃO audita secret.deleted", async () => {
    mockGetAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });

    const app = await buildApp();
    await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/secrets/openai`,
    });

    expect(mockCreateAuditLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "secret.deleted" })
    );
  });
});
