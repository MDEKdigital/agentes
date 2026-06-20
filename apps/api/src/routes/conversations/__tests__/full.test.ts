import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetConversationById,
  mockGetMessagesByConversation,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetConversationById: vi.fn(),
  mockGetMessagesByConversation: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getConversationById: mockGetConversationById,
  getMessagesByConversation: mockGetMessagesByConversation,
  getConversationNotes: vi.fn(),
  addConversationNote: vi.fn(),
  updateConversationTags: vi.fn(),
  getInboxConversations: vi.fn().mockResolvedValue({ conversations: [], total: 0 }),
  createAuditLog: vi.fn().mockResolvedValue({ id: "audit-uuid" }),
}));

import conversationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";
const CONV_ID = "conv-uuid-1";

const CONV_FIXTURE = {
  id: CONV_ID,
  organization_id: ORG_ID,
  status: "open",
  is_human_takeover: false,
  assigned_to: null,
  tags: [],
  contacts: { phone: "+5511999999999", name: "João" },
};

const MESSAGES_FIXTURE = [
  { id: "msg-1", conversation_id: CONV_ID, role: "user", content: "Olá", created_at: "2026-01-01T00:00:00Z" },
  { id: "msg-2", conversation_id: CONV_ID, role: "assistant", content: "Oi!", created_at: "2026-01-01T00:00:01Z" },
];

function makeDb(convOrgId: string | null = ORG_ID) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(
            convOrgId
              ? { data: { organization_id: convOrgId }, error: null }
              : { data: null, error: null }
          ),
        }),
      }),
    }),
  };
}

async function buildApp(role = "member") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
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
  mockGetConversationById.mockResolvedValue(CONV_FIXTURE);
  mockGetMessagesByConversation.mockResolvedValue(MESSAGES_FIXTURE);
});

describe("GET /conversations/:conversationId/full", () => {
  it("T1: 200 com envelope { conversation, messages }", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("conversation");
    expect(body).toHaveProperty("messages");
  });

  it("T2: conversation.id corresponde ao param da rota", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    const body = res.json();
    expect(body.conversation.id).toBe(CONV_ID);
    expect(body.conversation.organization_id).toBe(ORG_ID);
  });

  it("T3: messages é um array com os dados corretos", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    const body = res.json();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].id).toBe("msg-1");
    expect(body.messages[1].id).toBe("msg-2");
  });

  it("T4: conversa não encontrada → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    expect(res.statusCode).toBe(404);
  });

  it("T5: usuário não é membro da org → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    expect(res.statusCode).toBe(403);
  });

  it("(defense-in-depth) T6: getConversationById chamado com organizationId", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    expect(mockGetConversationById).toHaveBeenCalledTimes(1);
    expect(mockGetConversationById).toHaveBeenCalledWith(expect.anything(), CONV_ID, ORG_ID);
  });

  it("T7: getMessagesByConversation não é chamado quando conversa não existe", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    expect(mockGetMessagesByConversation).not.toHaveBeenCalled();
  });

  it("T8: getMessagesByConversation chamado com o conversationId correto", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/full` });

    expect(mockGetMessagesByConversation).toHaveBeenCalledWith(expect.anything(), CONV_ID, expect.any(String));
  });
});
