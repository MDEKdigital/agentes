import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAgent,
  mockCheckResourceLimit,
  mockGetAgentsByOrganization,
  mockGetAgentById,
  mockUpdateAgent,
  mockDeleteAgent,
  mockCreateAuditLog,
  mockResetAgentConversationsKeywordActivation,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateAgent: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
  mockGetAgentsByOrganization: vi.fn(),
  mockGetAgentById: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockDeleteAgent: vi.fn(),
  mockCreateAuditLog: vi.fn(),
  mockResetAgentConversationsKeywordActivation: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAgent: mockCreateAgent,
  checkResourceLimit: mockCheckResourceLimit,
  getAgentsByOrganization: mockGetAgentsByOrganization,
  getAgentById: mockGetAgentById,
  updateAgent: mockUpdateAgent,
  deleteAgent: mockDeleteAgent,
  createAuditLog: mockCreateAuditLog,
  resetAgentConversationsKeywordActivation: mockResetAgentConversationsKeywordActivation,
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

const AGENT_ID = "agent-uuid-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockCreateAgent.mockResolvedValue(mockCreatedAgent);
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 2, max: 5 });
  mockGetAgentsByOrganization.mockResolvedValue([mockCreatedAgent]);
  mockGetAgentById.mockResolvedValue(mockCreatedAgent);
  mockUpdateAgent.mockResolvedValue({ ...mockCreatedAgent, name: "Atualizado" });
  mockDeleteAgent.mockResolvedValue(undefined);
  mockCreateAuditLog.mockResolvedValue({ id: "audit-uuid" });
  mockResetAgentConversationsKeywordActivation.mockResolvedValue(undefined);
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

  it("cenário 7 (audit): cria agente com sucesso → registra agent.created no audit log", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents`,
      payload: validAgentBody,
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "agent.created",
        entity_type: "agent",
        entity_id: mockCreatedAgent.id,
      })
    );
  });
});

describe("GET /organizations/:organizationId/agents", () => {
  it("qualquer membro → 200 com lista de agentes", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/agents`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.agents).toHaveLength(1);
    expect(mockGetAgentsByOrganization).toHaveBeenCalledWith(expect.anything(), ORG_ID);
  });

  it("não é membro da org → 403", async () => {
    mockAuthMiddleware.mockImplementation(async (request: any) => {
      request.user = { id: USER_ID, memberships: [{ organization_id: "outra-org", role: "owner" }] };
    });
    const app = Fastify({ logger: false });
    await app.register(agentRoutes);

    const res = await app.inject({ method: "GET", url: `/organizations/${ORG_ID}/agents` });
    expect(res.statusCode).toBe(403);
    expect(mockGetAgentsByOrganization).not.toHaveBeenCalled();
  });
});

describe("GET /organizations/:organizationId/agents/:agentId", () => {
  it("membro da org → 200 com agente", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(AGENT_ID);
    expect(mockGetAgentById).toHaveBeenCalledWith(expect.anything(), AGENT_ID, ORG_ID);
  });

  it("agente não pertence à org → 404", async () => {
    mockGetAgentById.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /organizations/:organizationId/agents/:agentId", () => {
  it("body com campos server-managed (organization_id, id) → 400 sem atualizar", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
      payload: { organization_id: "outro-org", id: "outro-id" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockUpdateAgent).not.toHaveBeenCalled();
  });

  it("admin atualiza agente → 200 com agente atualizado", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
      payload: { name: "Atualizado" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("Atualizado");
    expect(mockUpdateAgent).toHaveBeenCalledWith(expect.anything(), AGENT_ID, ORG_ID, { name: "Atualizado" });
  });

  it("role agent → 403 sem atualizar", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
      payload: { name: "Atualizado" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateAgent).not.toHaveBeenCalled();
  });

  it("agente não encontrado → 404", async () => {
    mockGetAgentById.mockResolvedValue(null);
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
      payload: { name: "Atualizado" },
    });

    expect(res.statusCode).toBe(404);
    expect(mockUpdateAgent).not.toHaveBeenCalled();
  });

  it("(audit): atualiza agente com sucesso → registra agent.updated no audit log", async () => {
    const app = await buildApp("admin");
    await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
      payload: { name: "Atualizado" },
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "agent.updated",
        entity_type: "agent",
        entity_id: AGENT_ID,
      })
    );
  });
});

describe("DELETE /organizations/:organizationId/agents/:agentId", () => {
  it("admin deleta agente → 204", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
    });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteAgent).toHaveBeenCalledWith(expect.anything(), AGENT_ID, ORG_ID);
  });

  it("role agent → 403 sem deletar", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(mockDeleteAgent).not.toHaveBeenCalled();
  });

  it("agente não encontrado → 404 sem deletar", async () => {
    mockGetAgentById.mockResolvedValue(null);
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(mockDeleteAgent).not.toHaveBeenCalled();
  });

  it("(audit): deleta agente com sucesso → registra agent.deleted no audit log", async () => {
    const app = await buildApp("admin");
    await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}`,
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "agent.deleted",
        entity_type: "agent",
        entity_id: AGENT_ID,
      })
    );
  });
});
