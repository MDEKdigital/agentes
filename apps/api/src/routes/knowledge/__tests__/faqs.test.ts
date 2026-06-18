import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetAgentById,
  mockGetFaqsByAgent,
  mockCreateFaq,
  mockUpdateFaq,
  mockDeleteFaq,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetAgentById: vi.fn(),
  mockGetFaqsByAgent: vi.fn(),
  mockCreateFaq: vi.fn(),
  mockUpdateFaq: vi.fn(),
  mockDeleteFaq: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getAgentById: mockGetAgentById,
  getFaqsByAgent: mockGetFaqsByAgent,
  createFaq: mockCreateFaq,
  updateFaq: mockUpdateFaq,
  deleteFaq: mockDeleteFaq,
}));

import knowledgeFaqRoutes from "../faqs";

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const AGENT_ID = "00000000-0000-0000-0000-000000000002";
const FAQ_ID = "00000000-0000-0000-0000-000000000003";
const USER_ID = "00000000-0000-0000-0000-000000000004";

const mockAgent = { id: AGENT_ID, organization_id: ORG_ID, name: "Agente Teste" };

const mockFaq = {
  id: FAQ_ID,
  agent_id: AGENT_ID,
  organization_id: ORG_ID,
  question: "Como funciona?",
  answer: "Funciona assim.",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

function makeDb(faqOrgId: string | null = ORG_ID) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(
            faqOrgId
              ? { data: { organization_id: faqOrgId }, error: null }
              : { data: null, error: null }
          ),
        }),
      }),
    }),
  };
}

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(knowledgeFaqRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockGetAgentById.mockResolvedValue(mockAgent);
  mockGetFaqsByAgent.mockResolvedValue([mockFaq]);
  mockCreateFaq.mockResolvedValue(mockFaq);
  mockUpdateFaq.mockResolvedValue({ ...mockFaq, is_active: false });
  mockDeleteFaq.mockResolvedValue(undefined);
});

// ── GET /organizations/:orgId/agents/:agentId/faqs ────────────────────────────

describe("GET /organizations/:orgId/agents/:agentId/faqs", () => {
  it("membro da org → 200 com lista de faqs", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}/faqs`,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
    expect(mockGetFaqsByAgent).toHaveBeenCalledWith(expect.anything(), AGENT_ID, ORG_ID);
  });

  it("agente não encontrado → 404", async () => {
    mockGetAgentById.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}/faqs`,
    });
    expect(res.statusCode).toBe(404);
    expect(mockGetFaqsByAgent).not.toHaveBeenCalled();
  });

  it("não é membro → 403", async () => {
    mockAuthMiddleware.mockImplementation(async (req: any) => {
      req.user = { id: USER_ID, memberships: [{ organization_id: "outra-org", role: "admin" }] };
    });
    const app = Fastify({ logger: false });
    await app.register(knowledgeFaqRoutes);
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}/faqs`,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /organizations/:orgId/faqs ──────────────────────────────────────────

describe("POST /organizations/:orgId/faqs", () => {
  it("admin cria FAQ → 201", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/faqs`,
      payload: { agent_id: AGENT_ID, question: "Como funciona?", answer: "Assim." },
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateFaq).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agent_id: AGENT_ID, organization_id: ORG_ID })
    );
  });

  it("owner cria FAQ → 201", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/faqs`,
      payload: { agent_id: AGENT_ID, question: "Como funciona?", answer: "Assim." },
    });
    expect(res.statusCode).toBe(201);
  });

  it("role 'agent' → 403", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/faqs`,
      payload: { agent_id: AGENT_ID, question: "Como funciona?", answer: "Assim." },
    });
    expect(res.statusCode).toBe(403);
    expect(mockCreateFaq).not.toHaveBeenCalled();
  });

  it("agente não pertence à org → 404", async () => {
    mockGetAgentById.mockResolvedValue(null);
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/faqs`,
      payload: { agent_id: AGENT_ID, question: "Como funciona?", answer: "Assim." },
    });
    expect(res.statusCode).toBe(404);
    expect(mockCreateFaq).not.toHaveBeenCalled();
  });

  it("body inválido (sem question) → 400", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/faqs`,
      payload: { agent_id: AGENT_ID, answer: "Assim." },
    });
    expect(res.statusCode).toBe(400);
    expect(mockCreateFaq).not.toHaveBeenCalled();
  });
});

// ── PATCH /faqs/:faqId ────────────────────────────────────────────────────────

describe("PATCH /faqs/:faqId", () => {
  it("admin alterna is_active → 200", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/faqs/${FAQ_ID}`,
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateFaq).toHaveBeenCalledWith(expect.anything(), FAQ_ID, { is_active: false });
  });

  it("FAQ não encontrada → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/faqs/${FAQ_ID}`,
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(404);
    expect(mockUpdateFaq).not.toHaveBeenCalled();
  });

  it("não é membro da org da FAQ → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/faqs/${FAQ_ID}`,
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(403);
    expect(mockUpdateFaq).not.toHaveBeenCalled();
  });

  it("role 'agent' → 403", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "PATCH",
      url: `/faqs/${FAQ_ID}`,
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(403);
    expect(mockUpdateFaq).not.toHaveBeenCalled();
  });
});

// ── DELETE /faqs/:faqId ───────────────────────────────────────────────────────

describe("DELETE /faqs/:faqId", () => {
  it("admin deleta FAQ → 204", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/faqs/${FAQ_ID}`,
    });
    expect(res.statusCode).toBe(204);
    expect(mockDeleteFaq).toHaveBeenCalledWith(expect.anything(), FAQ_ID, ORG_ID);
  });

  it("FAQ não encontrada → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/faqs/${FAQ_ID}`,
    });
    expect(res.statusCode).toBe(404);
    expect(mockDeleteFaq).not.toHaveBeenCalled();
  });

  it("não é membro da org da FAQ → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/faqs/${FAQ_ID}`,
    });
    expect(res.statusCode).toBe(403);
    expect(mockDeleteFaq).not.toHaveBeenCalled();
  });

  it("role 'agent' → 403", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "DELETE",
      url: `/faqs/${FAQ_ID}`,
    });
    expect(res.statusCode).toBe(403);
    expect(mockDeleteFaq).not.toHaveBeenCalled();
  });
});
