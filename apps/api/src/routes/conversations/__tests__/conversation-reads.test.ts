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

// Simulates the inline lightweight org lookup the route now does first
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

// ── GET /conversations/:conversationId ────────────────────────────────────────

describe("GET /conversations/:conversationId", () => {
  it("membro da org → 200 com dados da conversa", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(CONV_ID);
    expect(body.organization_id).toBe(ORG_ID);
  });

  it("(defense-in-depth) getConversationById chamado com organizationId", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/conversations/${CONV_ID}` });
    expect(mockGetConversationById).toHaveBeenCalledWith(expect.anything(), CONV_ID, ORG_ID);
  });

  it("conversa não encontrada → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}` });
    expect(res.statusCode).toBe(404);
  });

  it("usuário não é membro da org da conversa → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}` });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /conversations/:conversationId/messages ───────────────────────────────

describe("GET /conversations/:conversationId/messages", () => {
  it("membro da org → 200 com lista de mensagens", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/messages` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].id).toBe("msg-1");
  });

  it("conversa não encontrada → 404 sem buscar mensagens", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/messages` });
    expect(res.statusCode).toBe(404);
    expect(mockGetMessagesByConversation).not.toHaveBeenCalled();
  });

  it("usuário não é membro da org da conversa → 403 sem buscar mensagens", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/conversations/${CONV_ID}/messages` });
    expect(res.statusCode).toBe(403);
    expect(mockGetMessagesByConversation).not.toHaveBeenCalled();
  });
});
