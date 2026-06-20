/**
 * C6 — TOCTOU bypass de limite de membros em convites concorrentes
 *
 * O padrão read→check→write permite que duas requests simultâneas passem pelo
 * checkResourceLimit e ambas criem convites acima do teto do plano.
 *
 * Fix: substituir createInvitation + checkResourceLimit como gate por
 * createInvitationAtomically (check+insert em operação única).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateInvitationAtomically,
  mockCreateInvitation,
  mockCheckResourceLimit,
  mockGetOrgInvitations,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateInvitationAtomically: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
  mockGetOrgInvitations: vi.fn(),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createInvitation: mockCreateInvitation,
  createInvitationAtomically: mockCreateInvitationAtomically,
  checkResourceLimit: mockCheckResourceLimit,
  getOrgInvitations: mockGetOrgInvitations,
  createAuditLog: mockCreateAuditLog,
}));

import invitationRoutes from "../index";

const ORG_ID  = "org-c6-uuid";
const USER_ID = "user-c6-uuid";

const INVITATION_FIXTURE = {
  id: "inv-c6-uuid",
  organization_id: ORG_ID,
  email: "novo@membro.com",
  role: "agent",
  invited_by: USER_ID,
  status: "pending",
  expires_at: "2026-07-01T00:00:00Z",
  created_at: "2026-06-20T00:00:00Z",
};

async function buildApp() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role: "owner" }] };
  });
  const app = Fastify({ logger: false });
  await app.register(invitationRoutes);
  return app;
}

async function sendInvitation(app: Awaited<ReturnType<typeof buildApp>>, payload = {}) {
  return app.inject({
    method: "POST",
    url: `/organizations/${ORG_ID}/invitations`,
    payload: { email: "novo@membro.com", role: "agent", ...payload },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAuditLog.mockResolvedValue({ id: "audit-c6" });
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 2, max: 3 });
  mockCreateInvitationAtomically.mockResolvedValue(INVITATION_FIXTURE);
  mockCreateInvitation.mockResolvedValue(INVITATION_FIXTURE);
});

// ── C6 tests ─────────────────────────────────────────────────────────────────

describe("C6 — convite atômico com guarda de limite (POST /organizations/:id/invitations)", () => {

  // 1. Rota usa createInvitationAtomically (não createInvitation direto)
  it("C6: rota chama createInvitationAtomically em vez de createInvitation diretamente", async () => {
    const app = await buildApp();
    await sendInvitation(app);

    // RED: current route calls createInvitation directly, not createInvitationAtomically
    expect(mockCreateInvitationAtomically).toHaveBeenCalledOnce();
  });

  // 2. createInvitation (o helper antigo sem guarda) NÃO é chamado
  it("C6: createInvitation (sem guarda atômica) NÃO é chamado diretamente", async () => {
    const app = await buildApp();
    await sendInvitation(app);

    // RED: current route calls createInvitation
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  // 3. Quando helper atômico retorna null (corrida perdida) → 403
  it("C6: corrida perdida — createInvitationAtomically retorna null → 403 com limit_exceeded", async () => {
    mockCreateInvitationAtomically.mockResolvedValue(null);
    const app = await buildApp();
    const res = await sendInvitation(app);

    // RED: current route uses createInvitation which never returns null
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ limit_exceeded: true });
  });

  // 4. Corrida perdida → audit NÃO dispara (sem falso sucesso)
  it("C6: quando helper atômico retorna null → audit.sent NÃO é chamado", async () => {
    mockCreateInvitationAtomically.mockResolvedValue(null);
    const app = await buildApp();
    await sendInvitation(app);

    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  // 5. Simulação de concorrência: dois requests com 1 slot restante → apenas 1 passa
  it("C6: concorrência — primeiro request retorna convite, segundo retorna null → segunda falha 403", async () => {
    const app = await buildApp();
    // First succeeds
    mockCreateInvitationAtomically.mockResolvedValueOnce(INVITATION_FIXTURE);
    const res1 = await sendInvitation(app, { email: "a@a.com" });
    // Second: lost race (limit now reached atomically)
    mockCreateInvitationAtomically.mockResolvedValueOnce(null);
    const res2 = await sendInvitation(app, { email: "b@b.com" });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(403);
    expect(res2.json()).toMatchObject({ limit_exceeded: true });
  });

  // 6. Fluxo nominal: helper retorna convite → 201 com o convite
  it("C6: fluxo nominal — createInvitationAtomically retorna convite → 201", async () => {
    const app = await buildApp();
    const res = await sendInvitation(app);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: INVITATION_FIXTURE.id });
  });

  // 7. Fluxo nominal: helper retorna convite → audit dispara
  it("C6: fluxo nominal — audit invitation.sent dispara quando convite criado", async () => {
    const app = await buildApp();
    await sendInvitation(app);

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "invitation.sent", organization_id: ORG_ID })
    );
  });

  // 8. checkResourceLimit ainda funciona como pré-check rápido
  it("regressão: limite já ultrapassado (checkResourceLimit=false) → 403 imediato sem chamar helper atômico", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });
    const app = await buildApp();
    const res = await sendInvitation(app);

    expect(res.statusCode).toBe(403);
    expect(mockCreateInvitationAtomically).not.toHaveBeenCalled();
  });

  // 9. Validação: email inválido → 400 sem chamar helper atômico
  it("regressão: email inválido → 400 sem chamar helper atômico", async () => {
    const app = await buildApp();
    const res = await sendInvitation(app, { email: "invalido" });

    expect(res.statusCode).toBe(400);
    expect(mockCreateInvitationAtomically).not.toHaveBeenCalled();
  });
});
