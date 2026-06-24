/**
 * POLÍTICA A — Agentes podem operar em qualquer conversa da organização.
 *
 * Evidências: (1) takeover/status só verificam membership, sem role guard;
 * (2) frontend não restringe role para "Assumir Conversa" ou change de status;
 * (3) takeover define assigned_to = caller.id — design pensado para agents.
 *
 * DELETE é a única exceção (role !== "agent" obrigatório — ação destrutiva).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockAuthMiddleware, mockGetAdminClient, mockCreateAuditLog } = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
  activateHumanTakeover: vi.fn().mockResolvedValue(true),
  cancelEnrollmentsByConversation: vi.fn().mockResolvedValue(undefined),
  getConversationById: vi.fn(),
  getMessagesByConversation: vi.fn().mockResolvedValue([]),
  getConversationNotes: vi.fn().mockResolvedValue([]),
  addConversationNote: vi.fn(),
  updateConversationTags: vi.fn(),
  getInboxConversations: vi.fn().mockResolvedValue({ conversations: [], total: 0 }),
}));

import conversationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const CONV_ID = "conv-uuid-1";
const AGENT_A = "agent-a-uuid";
const AGENT_B = "agent-b-uuid";
const ADMIN_ID = "admin-uuid";
const OWNER_ID = "owner-uuid";

function makeDb(assignedTo: string | null = null) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "organization_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: assignedTo }, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { organization_id: ORG_ID, assigned_to: assignedTo, status: "open" },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      };
    }),
  };
}

function buildApp(role: "agent" | "admin" | "owner", userId: string) {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: userId, memberships: [{ organization_id: ORG_ID, role }] };
  });
  const app = Fastify({ logger: false });
  return app.register(conversationRoutes).then(() => app);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb(null));
  mockCreateAuditLog.mockResolvedValue({});
});

// ── V5: PATCH /conversations/:id/takeover ─────────────────────────────────────
// POLÍTICA A: qualquer membro pode assumir qualquer conversa da org.

describe("V5 — Takeover: POLÍTICA A (agent acessa qualquer conversa da org)", () => {
  it("agent ativa takeover em conversa atribuída a si mesmo → 204", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(AGENT_A));
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(204);
  });

  it("agent ativa takeover em conversa SEM assigned_to → 204", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(204);
  });

  it("agent ativa takeover em conversa atribuída a OUTRO agent → 204 (POLÍTICA A)", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(AGENT_B));
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(204);
  });

  it("admin ativa takeover → 204", async () => {
    const app = await buildApp("admin", ADMIN_ID);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(204);
  });

  it("owner ativa takeover → 204", async () => {
    const app = await buildApp("owner", OWNER_ID);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(204);
  });

  it("agent desativa takeover em conversa atribuída a outro agent → 204 (POLÍTICA A)", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(AGENT_B));
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: false },
    });
    expect(res.statusCode).toBe(204);
  });
});

// ── V6: PATCH /conversations/:id/status ──────────────────────────────────────
// POLÍTICA A: qualquer membro pode alterar status de qualquer conversa da org.

describe("V6 — Status: POLÍTICA A (agent acessa qualquer conversa da org)", () => {
  it("agent altera status de conversa atribuída a si mesmo → 204", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(AGENT_A));
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/status`,
      payload: { status: "resolved" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("agent altera status de conversa SEM assigned_to → 204", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/status`,
      payload: { status: "waiting" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("agent altera status de conversa atribuída a OUTRO agent → 204 (POLÍTICA A)", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(AGENT_B));
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/status`,
      payload: { status: "resolved" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("admin altera status → 204", async () => {
    const app = await buildApp("admin", ADMIN_ID);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/status`,
      payload: { status: "closed" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("owner altera status → 204", async () => {
    const app = await buildApp("owner", OWNER_ID);
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/status`,
      payload: { status: "open" },
    });
    expect(res.statusCode).toBe(204);
  });
});

// ── DELETE: contrato preservado (agents bloqueados) ───────────────────────────
// Esta restrição é intencional e diferencia ações destrutivas.

describe("DELETE — agent NÃO pode deletar (exceção intencional à POLÍTICA A)", () => {
  it("agent tenta deletar conversa → 403", async () => {
    const app = await buildApp("agent", AGENT_A);
    const res = await app.inject({
      method: "DELETE",
      url: `/conversations/${CONV_ID}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin não é bloqueado pelo guard de role → passa pelo 403", async () => {
    const app = await buildApp("admin", ADMIN_ID);
    const res = await app.inject({
      method: "DELETE",
      url: `/conversations/${CONV_ID}`,
    });
    expect(res.statusCode).not.toBe(403);
  });
});
