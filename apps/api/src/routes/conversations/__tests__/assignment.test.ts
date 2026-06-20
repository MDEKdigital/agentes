import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
  getConversationById: vi.fn(),
  getMessagesByConversation: vi.fn(),
  getConversationNotes: vi.fn(),
  addConversationNote: vi.fn(),
  updateConversationTags: vi.fn(),
  getInboxConversations: vi.fn().mockResolvedValue({ conversations: [], total: 0 }),
}));

import conversationRoutes from "../index";

const ORG_A = "org-a-uuid";
const ORG_B = "org-b-uuid";
const CALLER_ID = "caller-user-uuid";
const USER_ORG_A = "user-in-org-a-uuid";
const USER_ORG_B = "user-in-org-b-uuid";
const CONV_ID = "conv-uuid-1";

function makeDb({
  convOrgId = ORG_A as string | null,
  assigneeMembershipExists = true,
  trackUpdate = { called: false },
} = {}) {
  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockImplementation(() => {
        trackUpdate.called = true;
        return Promise.resolve({ error: null });
      }),
    }),
  });

  const db = {
    from: vi.fn((table: string) => {
      if (table === "conversations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(
                convOrgId
                  ? { data: { organization_id: convOrgId, assigned_to: null }, error: null }
                  : { data: null, error: null }
              ),
            }),
          }),
          update: updateFn,
        };
      }
      if (table === "organization_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: assigneeMembershipExists ? { user_id: USER_ORG_A } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return { select: vi.fn(), update: vi.fn() };
    }),
    _updateFn: updateFn,
  };
  return db;
}

async function buildApp(orgId = ORG_A) {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: CALLER_ID,
      memberships: [{ organization_id: orgId, role: "admin" }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(conversationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAuditLog.mockResolvedValue({ id: "audit-uuid" });
});

describe("PATCH /conversations/:conversationId/assignment — validação de membro", () => {
  it("RED: assigned_to pertence a outra org → 422", async () => {
    const db = makeDb({ assigneeMembershipExists: false });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: USER_ORG_B },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Usuário atribuído não pertence a esta organização",
    });
  });

  it("RED: update NÃO acontece quando assigned_to é cross-tenant", async () => {
    const tracker = { called: false };
    const db = makeDb({ assigneeMembershipExists: false, trackUpdate: tracker });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp();

    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: USER_ORG_B },
    });

    expect(tracker.called).toBe(false);
  });

  it("RED: audit NÃO acontece quando assigned_to é cross-tenant", async () => {
    const db = makeDb({ assigneeMembershipExists: false });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp();

    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: USER_ORG_B },
    });

    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it("GREEN: assigned_to pertence à mesma org → 204", async () => {
    const db = makeDb({ assigneeMembershipExists: true });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: USER_ORG_A },
    });

    expect(res.statusCode).toBe(204);
  });

  it("GREEN: assigned_to = null → 204 sem verificar membership do target", async () => {
    // maybeSingle nunca deve ser chamado quando assigned_to é null
    const db = makeDb({ assigneeMembershipExists: false });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: null },
    });

    expect(res.statusCode).toBe(204);
    // membership do target não deve ter sido consultada
    const membersCalls = (db.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => args[0] === "organization_members"
    );
    expect(membersCalls).toHaveLength(0);
  });

  it("GREEN: audit é registrado quando assigned_to é válido", async () => {
    const db = makeDb({ assigneeMembershipExists: true });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp();

    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: USER_ORG_A },
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.assignment_changed",
        organization_id: ORG_A,
        entity_id: CONV_ID,
      })
    );
  });

  it("conversa não encontrada → 404 (comportamento preservado)", async () => {
    const db = makeDb({ convOrgId: null });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: USER_ORG_A },
    });

    expect(res.statusCode).toBe(404);
  });

  it("caller não é membro da org da conversa → 403 (comportamento preservado)", async () => {
    const db = makeDb({ convOrgId: ORG_B });
    mockGetAdminClient.mockReturnValue(db);
    const app = await buildApp(ORG_A); // caller só está em ORG_A, conv está em ORG_B

    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: USER_ORG_A },
    });

    expect(res.statusCode).toBe(403);
  });
});
