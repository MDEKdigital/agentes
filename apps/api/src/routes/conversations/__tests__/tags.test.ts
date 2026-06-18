import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockUpdateConversationTags,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockUpdateConversationTags: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  updateConversationTags: mockUpdateConversationTags,
}));

import conversationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";
const CONV_ID = "conv-uuid-1";

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
  mockUpdateConversationTags.mockResolvedValue(undefined);
});

// ── PATCH /conversations/:id/tags ─────────────────────────────────────────────

describe("PATCH /conversations/:conversationId/tags", () => {
  it("membro atualiza tags → 204", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: ["urgente", "vip"] },
    });
    expect(res.statusCode).toBe(204);
    expect(mockUpdateConversationTags).toHaveBeenCalledWith(
      expect.anything(),
      CONV_ID,
      ORG_ID,
      ["urgente", "vip"]
    );
  });

  it("lista de tags vazia (limpar todas) → 204", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: [] },
    });
    expect(res.statusCode).toBe(204);
    expect(mockUpdateConversationTags).toHaveBeenCalledWith(
      expect.anything(),
      CONV_ID,
      ORG_ID,
      []
    );
  });

  it("conversa não encontrada → 404 sem atualizar tags", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: ["urgente"] },
    });
    expect(res.statusCode).toBe(404);
    expect(mockUpdateConversationTags).not.toHaveBeenCalled();
  });

  it("usuário não é membro da org da conversa → 403 sem atualizar tags", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: ["urgente"] },
    });
    expect(res.statusCode).toBe(403);
    expect(mockUpdateConversationTags).not.toHaveBeenCalled();
  });

  it("body sem campo tags → 400 sem atualizar", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mockUpdateConversationTags).not.toHaveBeenCalled();
  });

  it("tags com valor não-array → 400 sem atualizar", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/tags`,
      payload: { tags: "urgente" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockUpdateConversationTags).not.toHaveBeenCalled();
  });
});
