import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAgent,
  mockCheckResourceLimit,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateAgent: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAgent: mockCreateAgent,
  checkResourceLimit: mockCheckResourceLimit,
}));

import agentRoutes from "../index";

// ── helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

const validAgentBody = {
  name: "Agente de Vendas",
  description: "Auxiliar no processo de vendas",
  system_prompt: "Você é um assistente de vendas profissional.",
  model: "gpt-4o-mini",
  provider: "openai",
  temperature: 0.7,
  max_tokens: 1024,
  max_steps: 5,
  tools_config: { search_knowledge: true, search_faq: false },
  activation_rules: [],
};

const mockCreatedAgent = {
  id: "agent-uuid-1",
  organization_id: ORG_ID,
  ...validAgentBody,
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(agentRoutes);
  return app;
}

// ── default state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockCreateAgent.mockResolvedValue(mockCreatedAgent);
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 2, max: 5 });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /organizations/:organizationId/agents", () => {
  it("cenário 1: dentro do limite → cria agente → 201", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents`,
      payload: validAgentBody,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe("agent-uuid-1");
    expect(mockCreateAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: ORG_ID, name: "Agente de Vendas" })
    );
  });

  it("cenário 2: limite de agentes atingido → NÃO cria → 403 com limit_exceeded", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: false, current: 5, max: 5 });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents`,
      payload: validAgentBody,
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.limit_exceeded).toBe(true);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it("cenário 3: sem assinatura (max: null) → cria agente → 201", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 10, max: null });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents`,
      payload: validAgentBody,
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateAgent).toHaveBeenCalled();
  });

  it("cenário 4: role 'agent' → 403 sem checar limites", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents`,
      payload: validAgentBody,
    });

    expect(res.statusCode).toBe(403);
    expect(mockCheckResourceLimit).not.toHaveBeenCalled();
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it("cenário 5: body inválido (sem name) → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents`,
      payload: { ...validAgentBody, name: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it("cenário 6: checkResourceLimit chamado com 'agents' e org correta", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents`,
      payload: validAgentBody,
    });

    expect(mockCheckResourceLimit).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      "agents"
    );
  });
});
