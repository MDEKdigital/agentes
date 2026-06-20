/**
 * C8 — Lost update: takeover concorrente
 *
 * takeover=true deve usar update condicional (WHERE is_human_takeover=false).
 * Se outra requisição já ativou o takeover antes, o segundo ator recebe 409.
 * Audit só dispara quando houve update real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
  mockActivateHumanTakeover,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn(),
  mockActivateHumanTakeover: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
  activateHumanTakeover: mockActivateHumanTakeover,
  // other helpers used by other routes in the same index.ts
  getConversationNotes: vi.fn(),
  addConversationNote: vi.fn(),
  updateConversationTags: vi.fn(),
  getConversationById: vi.fn(),
  getMessagesByConversation: vi.fn(),
  getInboxConversations: vi.fn(),
}));

import conversationRoutes from "../index";

const ORG_ID  = "org-uuid-c8";
const USER_ID = "user-uuid-c8";
const CONV_ID = "conv-uuid-c8";

function makeDb(orgId: string | null = ORG_ID, extra: Record<string, unknown> = {}) {
  const data = orgId
    ? { organization_id: orgId, assigned_to: null, is_human_takeover: false, ...extra }
    : null;

  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
      // fallback update for takeover=false path (deactivation — no conditional)
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    }),
  };
}

async function buildApp() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role: "agent" }] };
  });
  const app = Fastify({ logger: false });
  await app.register(conversationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockCreateAuditLog.mockResolvedValue({ id: "audit-c8" });
  mockActivateHumanTakeover.mockResolvedValue(true); // default: success
});

// ── TAKEOVER — guarda condicional ─────────────────────────────────────────────

describe("C8 — takeover condicional (PATCH /conversations/:id/takeover)", () => {

  // 1. Fluxo normal: sem takeover ativo → 204
  it("takeover normal (conversa livre): chama activateHumanTakeover e retorna 204", async () => {
    mockActivateHumanTakeover.mockResolvedValue(true);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });

    // RED: route still calls db.from().update() directly → activateHumanTakeover not called
    expect(mockActivateHumanTakeover).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(204);
  });

  // 2. Corrida: outro ator já assumiu → zero rows → 409
  it("takeover concorrente: quando já existe takeover ativo → 409", async () => {
    mockActivateHumanTakeover.mockResolvedValue(false); // 0 rows affected

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });

    // RED: current route always returns 204 regardless
    expect(res.statusCode).toBe(409);
  });

  // 3. Conflito → audit NÃO dispara (falso sucesso deve ser evitado)
  it("takeover concorrente: audit NÃO dispara quando update não afetou linhas", async () => {
    mockActivateHumanTakeover.mockResolvedValue(false);

    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });

    // RED: current route audits unconditionally
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  // 4. Sucesso real: activateHumanTakeover true → audit dispara
  it("takeover normal: audit dispara com takeover_started quando update real", async () => {
    mockActivateHumanTakeover.mockResolvedValue(true);
    const app = await buildApp();

    await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });

    // RED: current route doesn't call activateHumanTakeover → unconditional audit
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.takeover_started",
        organization_id: ORG_ID,
      })
    );
  });

  // 5. Quantidade de linhas importa: zero linhas → sem falso sucesso
  it("zero linhas afetadas → resposta coerente de conflito, não 204", async () => {
    mockActivateHumanTakeover.mockResolvedValue(false);
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });

    expect(res.statusCode).not.toBe(204);
    expect(res.statusCode).toBe(409);
  });

  // Regressão: takeover=false (deactivation) continua funcionando normalmente
  it("regressão: desativar takeover → 204 sem guarda condicional", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: false },
    });
    expect(res.statusCode).toBe(204);
  });

  // Regressão: 404 quando conversa não existe
  it("regressão: conversa inexistente → 404", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(null));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(404);
  });

  // Regressão: 403 quando usuário não é membro
  it("regressão: usuário fora da org → 403", async () => {
    mockGetAdminClient.mockReturnValue(makeDb("outra-org"));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONV_ID}/takeover`,
      payload: { takeover: true },
    });
    expect(res.statusCode).toBe(403);
  });
});
