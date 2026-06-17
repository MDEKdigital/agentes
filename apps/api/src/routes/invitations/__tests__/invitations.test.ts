import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateInvitation,
  mockCheckResourceLimit,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockCreateInvitation: vi.fn(),
  mockCheckResourceLimit: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createInvitation: mockCreateInvitation,
  checkResourceLimit: mockCheckResourceLimit,
}));

import invitationRoutes from "../index";

// ── helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

const mockCreatedInvitation = {
  id: "inv-uuid-1",
  organization_id: ORG_ID,
  email: "novo@membro.com",
  role: "agent",
  invited_by: USER_ID,
  status: "pending",
  expires_at: "2026-06-24T00:00:00Z",
  created_at: "2026-06-17T00:00:00Z",
};

async function buildApp(role = "owner") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(invitationRoutes);
  return app;
}

// ── default state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockCreateInvitation.mockResolvedValue(mockCreatedInvitation);
  mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 2, max: 10 });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /organizations/:organizationId/invitations", () => {
  it("cenário 1: dentro do limite → cria convite → 201", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/invitations`,
      payload: { email: "novo@membro.com", role: "agent" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe("inv-uuid-1");
    expect(mockCreateInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        email: "novo@membro.com",
        role: "agent",
        invited_by: USER_ID,
      })
    );
  });

  it("cenário 2: limite de membros atingido → NÃO cria → 403 com limit_exceeded", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: false, current: 10, max: 10 });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/invitations`,
      payload: { email: "novo@membro.com", role: "agent" },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.limit_exceeded).toBe(true);
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it("cenário 3: sem assinatura (max: null) → cria convite → 201", async () => {
    mockCheckResourceLimit.mockResolvedValue({ allowed: true, current: 99, max: null });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/invitations`,
      payload: { email: "novo@membro.com", role: "admin" },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateInvitation).toHaveBeenCalled();
  });

  it("cenário 4: role 'agent' → 403 sem checar limites", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/invitations`,
      payload: { email: "novo@membro.com", role: "agent" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockCheckResourceLimit).not.toHaveBeenCalled();
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it("cenário 5: email inválido → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/invitations`,
      payload: { email: "nao-e-email", role: "agent" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it("cenário 6: role inválido → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/invitations`,
      payload: { email: "novo@membro.com", role: "superadmin" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it("cenário 7: checkResourceLimit chamado com 'members' e org correta", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/invitations`,
      payload: { email: "novo@membro.com", role: "agent" },
    });

    expect(mockCheckResourceLimit).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      "members"
    );
  });
});
