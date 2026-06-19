import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockDbFrom,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockDbFrom: vi.fn(),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
}));

import conversationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";
const CONV_ID = "conv-uuid-1";

function makeDb(convOrgId: string | null = ORG_ID) {
  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };
  (updateChain as any).mockResolvedValue = () => {};

  const selectResult = convOrgId
    ? { data: { organization_id: convOrgId }, error: null }
    : { data: null, error: null };

  const updateResult = { error: null };

  const db = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(selectResult),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(updateResult),
        }),
      }),
    }),
  };
  return db;
}

async function buildApp(role = "member", userId = USER_ID) {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: userId,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(conversationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockCreateAuditLog.mockResolvedValue({ id: "audit-uuid" });
});

// ── PATCH /conversations/:id/takeover ────────────────────────────────────────

describe("PATCH /conversations/:conversationId/takeover", () => {
  it("membro da org ativa takeover → 204", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(204);
  });

  it("membro da org desativa takeover → 204", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: false },
    });
    expect(res.statusCode).toBe(204);
  });

  it("conversa não encontrada → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it("usuário não é membro da org da conversa → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("(audit): ativa takeover → registra conversation.takeover_started", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "conversation.takeover_started",
        entity_type: "conversation",
        entity_id: CONV_ID,
      })
    );
  });

  it("(audit): desativa takeover → registra conversation.takeover_ended", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: false },
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "conversation.takeover_ended",
        entity_type: "conversation",
        entity_id: CONV_ID,
      })
    );
  });

  it("body inválido (sem takeover) → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── PATCH /conversations/:id/assignment ──────────────────────────────────────

describe("PATCH /conversations/:conversationId/assignment", () => {
  it("atribui conversa a um usuário → 204", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: "other-user-uuid" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("desatribui conversa (assigned_to: null) → 204", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: null },
    });
    expect(res.statusCode).toBe(204);
  });

  it("conversa não encontrada → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: "user-uuid" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("usuário não é membro da org da conversa → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: "user-uuid" },
    });
    expect(res.statusCode).toBe(403);
  });
});
