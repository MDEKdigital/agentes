import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
  mockUpdateConversationTags,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockUpdateConversationTags: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
  updateConversationTags: mockUpdateConversationTags,
  getConversationNotes: vi.fn().mockResolvedValue([]),
  addConversationNote: vi.fn(),
  getConversationById: vi.fn(),
  getMessagesByConversation: vi.fn().mockResolvedValue([]),
  getInboxConversations: vi.fn().mockResolvedValue({ conversations: [], total: 0 }),
}));

import conversationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";
const CONV_ID = "conv-uuid-1";

function makeDb(
  convOrgId: string | null = ORG_ID,
  convStatus: string = "open",
  convAssignedTo: string | null = null
) {
  const single = vi.fn().mockResolvedValue(
    convOrgId
      ? { data: { organization_id: convOrgId, status: convStatus, assigned_to: convAssignedTo }, error: null }
      : { data: null, error: null }
  );
  const updateResult = { error: null };
  const deleteResult = { error: null };
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(updateResult),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(deleteResult),
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
  await app.register(conversationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockCreateAuditLog.mockResolvedValue({});
  mockUpdateConversationTags.mockResolvedValue(undefined);
});

describe("Audit logs — conversations", () => {
  it("conversation.tags_updated é auditado ao atualizar tags", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: ["urgente", "vip"] },
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.tags_updated",
        entity_type: "conversation",
        entity_id: CONV_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("conversation.assignment_changed é auditado ao atribuir conversa", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: "agent-user-id" },
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.assignment_changed",
        entity_type: "conversation",
        entity_id: CONV_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("conversation.status_changed é auditado ao alterar status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/status`,
      payload: { status: "resolved" },
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.status_changed",
        entity_type: "conversation",
        entity_id: CONV_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
        metadata: expect.objectContaining({ new_status: "resolved" }),
      })
    );
  });

  it("conversation.deleted é auditado ao deletar conversa", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/conversations/${CONV_ID}`,
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.deleted",
        entity_type: "conversation",
        entity_id: CONV_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });
});

// ── R12: metadados de estado anterior ─────────────────────────────────────────

describe("R12: estado anterior nos eventos de conversa", () => {
  it("R12: conversation.status_changed inclui old_status e new_status", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/status`,
      payload: { status: "resolved" },
    });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.status_changed",
        metadata: expect.objectContaining({
          old_status: expect.anything(),
          new_status: "resolved",
        }),
      })
    );
  });

  it("R12: conversation.assignment_changed inclui previous_assigned_to", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(ORG_ID, "open", "prev-user-uuid"));
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/assignment`,
      payload: { assigned_to: "new-user-uuid" },
    });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.assignment_changed",
        metadata: expect.objectContaining({
          previous_assigned_to: "prev-user-uuid",
          assigned_to: "new-user-uuid",
        }),
      })
    );
  });
});

// ── R13: tags sem PII ─────────────────────────────────────────────────────────

describe("R13: tags_updated não deve persistir array bruto de tags", () => {
  it("R13: metadata NÃO contém o array de tags brutas", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: ["urgente", "vip", "cpf:123456789"] },
    });
    expect(mockCreateAuditLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ tags: expect.anything() }),
      })
    );
  });

  it("R13: metadata contém tag_count em vez do conteúdo das tags", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: ["urgente", "vip"] },
    });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.tags_updated",
        metadata: expect.objectContaining({ tag_count: 2 }),
      })
    );
  });
});
