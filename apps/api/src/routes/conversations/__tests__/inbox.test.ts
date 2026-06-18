import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetInboxConversations,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetInboxConversations: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getInboxConversations: mockGetInboxConversations,
  getConversationNotes: vi.fn(),
  addConversationNote: vi.fn(),
  updateConversationTags: vi.fn(),
  getConversationById: vi.fn(),
  getMessagesByConversation: vi.fn(),
}));

import conversationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

const CONV_FIXTURE = [
  {
    id: "conv-1",
    organization_id: ORG_ID,
    status: "open",
    is_human_takeover: false,
    last_message_at: "2026-01-01T00:00:00Z",
    tags: [],
    assigned_to: null,
    contacts: { phone: "+5511999999999", name: "João" },
    agents: { name: "Bot Vendas" },
  },
];

async function buildApp(orgId = ORG_ID) {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: orgId, role: "member" }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(conversationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockGetInboxConversations.mockResolvedValue(CONV_FIXTURE);
});

// ── GET /organizations/:organizationId/conversations ──────────────────────────

describe("GET /organizations/:organizationId/conversations", () => {
  it("membro da org → 200 com lista de conversas", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/conversations`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("conv-1");
  });

  it("sem ?status → getInboxConversations chamado com status undefined", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/conversations`,
    });
    expect(mockGetInboxConversations).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      undefined
    );
  });

  it("com ?status=open → getInboxConversations chamado com status 'open'", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/conversations?status=open`,
    });
    expect(mockGetInboxConversations).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      "open"
    );
  });

  it("com ?status=resolved → getInboxConversations chamado com status 'resolved'", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/conversations?status=resolved`,
    });
    expect(mockGetInboxConversations).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      "resolved"
    );
  });

  it("usuário não é membro da org → 403 sem buscar conversas", async () => {
    const app = await buildApp("outra-org");
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/conversations`,
    });
    expect(res.statusCode).toBe(403);
    expect(mockGetInboxConversations).not.toHaveBeenCalled();
  });
});
