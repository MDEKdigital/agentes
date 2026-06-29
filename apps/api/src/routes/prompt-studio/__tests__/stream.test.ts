import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockAuthMiddleware, mockGetAdminClient, mockResolveKey } = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { encrypted_key: "sk-test" } }) })),
          maybeSingle: vi.fn().mockResolvedValue({ data: { encrypted_key: "sk-test" } }),
          single: vi.fn().mockResolvedValue({ data: { system_prompt: "mocked prompt" }, error: null }),
          limit: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { system_prompt: "mocked prompt" }, error: null }) })),
        })),
        // resolveSystemPrompt calls .select().limit(1).single() without .eq()
        limit: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { system_prompt: "mocked prompt" }, error: null }) })),
      })),
    })),
  })),
  mockResolveKey: vi.fn().mockResolvedValue("sk-test"),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));
vi.mock("@aula-agente/database", () => ({ getAdminClient: mockGetAdminClient }));
vi.mock("../../../lib/crypto", () => ({ decrypt: vi.fn((v: string) => v) }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import promptStudioRoutes from "../index";

function buildApp() {
  const app = Fastify();
  mockAuthMiddleware.mockImplementation(async (req: { user: { id: string; memberships: { organization_id: string; role: string }[] } }) => {
    req.user = { id: "user-1", memberships: [{ organization_id: "org-1", role: "owner" }] };
  });
  app.register(promptStudioRoutes);
  return app;
}

describe("POST /organizations/:orgId/prompt-studio/chat/stream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing messages body", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-1/prompt-studio/chat/stream",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown org", async () => {
    const app = buildApp();
    mockAuthMiddleware.mockImplementationOnce(async (req: { user: { id: string; memberships: never[] } }) => {
      req.user = { id: "user-1", memberships: [] };
    });
    const res = await app.inject({
      method: "POST",
      url: "/organizations/other-org/prompt-studio/chat/stream",
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("streams SSE events when OpenAI responds", async () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Olá" }, finish_reason: null }] })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    let chunkIndex = 0;

    const mockStream = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (chunkIndex < chunks.length) {
              return { value: new TextEncoder().encode(chunks[chunkIndex++]), done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };

    mockFetch.mockResolvedValueOnce({ ok: true, body: mockStream });

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org-1/prompt-studio/chat/stream",
      payload: { messages: [{ role: "user", content: "oi" }] },
    });

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain('"type":"chunk"');
    expect(res.body).toContain('"type":"done"');
  });
});
