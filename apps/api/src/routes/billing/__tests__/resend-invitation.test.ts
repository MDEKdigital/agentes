import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetAdminClient,
  mockFindInvitationByEmailForResend,
  mockRenewInvitationExpiry,
  mockSendWelcomeEmailApi,
  mockAuthMiddleware,
  mockRequireOrg,
} = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn(),
  mockFindInvitationByEmailForResend: vi.fn(),
  mockRenewInvitationExpiry: vi.fn(),
  mockSendWelcomeEmailApi: vi.fn(),
  mockAuthMiddleware: vi.fn(async () => {}),
  mockRequireOrg: vi.fn(async () => {}),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  findInvitationByEmailForResend: mockFindInvitationByEmailForResend,
  renewInvitationExpiry: mockRenewInvitationExpiry,
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
  requireOrg: mockRequireOrg,
}));

vi.mock("../../../lib/email", () => ({
  sendWelcomeEmailApi: mockSendWelcomeEmailApi,
}));

import billingRoutes from "../index";

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(billingRoutes);
  return app;
}

const NEUTRAL_MSG = "Se um convite estiver disponível, o email foi reenviado.";

const mockInvitation = {
  id: "inv-uuid-1",
  organization_id: "org-uuid-1",
  email: "cliente@empresa.com",
  role: "owner",
  invited_by: null,
  status: "pending",
  expires_at: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
  accepted_at: null,
  accepted_by_user_id: null,
  created_at: "2026-06-01T00:00:00Z",
};

const mockRenewedInvitation = {
  ...mockInvitation,
  expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
};

// ── default state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthMiddleware.mockImplementation(async () => {});
  mockGetAdminClient.mockReturnValue({});
  mockFindInvitationByEmailForResend.mockResolvedValue(mockInvitation);
  mockRenewInvitationExpiry.mockResolvedValue(mockRenewedInvitation);
  mockSendWelcomeEmailApi.mockResolvedValue(undefined);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /billing/resend-invitation", () => {
  it("cenário 1: body ausente → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/resend-invitation",
    });
    expect(res.statusCode).toBe(400);
  });

  it("cenário 2: email inválido (não é email) → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/resend-invitation",
      payload: { email: "nao-e-um-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cenário 3: email válido com convite pendente → renova expiry, envia email, retorna 200 + mensagem neutra", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/resend-invitation",
      payload: { email: "cliente@empresa.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe(NEUTRAL_MSG);

    expect(mockFindInvitationByEmailForResend).toHaveBeenCalledWith(
      expect.anything(),
      "cliente@empresa.com"
    );
    expect(mockRenewInvitationExpiry).toHaveBeenCalledWith(
      expect.anything(),
      "inv-uuid-1",
      expect.any(String)
    );
    expect(mockSendWelcomeEmailApi).toHaveBeenCalledOnce();
  });

  it("cenário 4: email válido sem convite → retorna 200 + mesma mensagem neutra (não vaza existência)", async () => {
    mockFindInvitationByEmailForResend.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/resend-invitation",
      payload: { email: "naoexiste@empresa.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe(NEUTRAL_MSG);

    // Não deve tentar renovar nem enviar email
    expect(mockRenewInvitationExpiry).not.toHaveBeenCalled();
    expect(mockSendWelcomeEmailApi).not.toHaveBeenCalled();
  });

  it("cenário 5: envio de email falha → ainda retorna 200 (non-fatal)", async () => {
    mockSendWelcomeEmailApi.mockRejectedValue(new Error("Resend down"));

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/resend-invitation",
      payload: { email: "cliente@empresa.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe(NEUTRAL_MSG);
  });

  it("cenário 6: erro no banco → 500", async () => {
    mockFindInvitationByEmailForResend.mockRejectedValue(new Error("db error"));

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/billing/resend-invitation",
      payload: { email: "cliente@empresa.com" },
    });

    expect(res.statusCode).toBe(500);
  });
});
