import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetConversationNotes,
  mockAddConversationNote,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetConversationNotes: vi.fn(),
  mockAddConversationNote: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getConversationNotes: mockGetConversationNotes,
  addConversationNote: mockAddConversationNote,
}));

import conversationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";
const CONV_ID = "conv-uuid-1";
const NOTE_ID = "note-uuid-1";

const mockNote = {
  id: NOTE_ID,
  conversation_id: CONV_ID,
  organization_id: ORG_ID,
  user_id: USER_ID,
  content: "Nota de teste",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

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
  mockGetConversationNotes.mockResolvedValue([mockNote]);
  mockAddConversationNote.mockResolvedValue(mockNote);
});

// ── GET /conversations/:id/notes ──────────────────────────────────────────────

describe("GET /conversations/:conversationId/notes", () => {
  it("membro da org → 200 com lista de notas", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/conversations/${CONV_ID}/notes`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].content).toBe("Nota de teste");
    expect(mockGetConversationNotes).toHaveBeenCalledWith(expect.anything(), CONV_ID);
  });

  it("conversa não encontrada → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/conversations/${CONV_ID}/notes`,
    });
    expect(res.statusCode).toBe(404);
    expect(mockGetConversationNotes).not.toHaveBeenCalled();
  });

  it("usuário não é membro da org da conversa → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/conversations/${CONV_ID}/notes`,
    });
    expect(res.statusCode).toBe(403);
    expect(mockGetConversationNotes).not.toHaveBeenCalled();
  });
});

// ── POST /conversations/:id/notes ─────────────────────────────────────────────

describe("POST /conversations/:conversationId/notes", () => {
  it("membro da org cria nota → 201 com nota criada", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/conversations/${CONV_ID}/notes`,
      payload: { content: "Nota de teste" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.content).toBe("Nota de teste");
    expect(mockAddConversationNote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversation_id: CONV_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
        content: "Nota de teste",
      })
    );
  });

  it("user_id é extraído do JWT, não do body", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/conversations/${CONV_ID}/notes`,
      payload: { content: "Teste", user_id: "attacker-id" },
    });
    expect(mockAddConversationNote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: USER_ID })
    );
  });

  it("conteúdo vazio → 400 sem criar nota", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/conversations/${CONV_ID}/notes`,
      payload: { content: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(mockAddConversationNote).not.toHaveBeenCalled();
  });

  it("body sem content → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/conversations/${CONV_ID}/notes`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mockAddConversationNote).not.toHaveBeenCalled();
  });

  it("conversa não encontrada → 404 sem criar nota", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/conversations/${CONV_ID}/notes`,
      payload: { content: "Nota" },
    });
    expect(res.statusCode).toBe(404);
    expect(mockAddConversationNote).not.toHaveBeenCalled();
  });

  it("usuário não é membro da org da conversa → 403 sem criar nota", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/conversations/${CONV_ID}/notes`,
      payload: { content: "Nota" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockAddConversationNote).not.toHaveBeenCalled();
  });
});
