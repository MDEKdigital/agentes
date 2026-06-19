import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetOrgMembersWithEmail,
  mockGetMemberById,
  mockUpdateMemberRole,
  mockRemoveMember,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockGetOrgMembersWithEmail: vi.fn(),
  mockGetMemberById: vi.fn(),
  mockUpdateMemberRole: vi.fn(),
  mockRemoveMember: vi.fn(),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getOrgMembersWithEmail: mockGetOrgMembersWithEmail,
  getMemberById: mockGetMemberById,
  updateMemberRole: mockUpdateMemberRole,
  removeMember: mockRemoveMember,
  createAuditLog: mockCreateAuditLog,
}));

import membersRoutes from "../index";

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";
const MEMBER_ID = "member-uuid-99";

const mockAgentMember = {
  id: MEMBER_ID,
  organization_id: ORG_ID,
  user_id: "another-user-uuid",
  email: "agent@test.com",
  role: "agent",
  created_at: "2026-06-01T00:00:00Z",
};

const mockOwnerMember = {
  id: "current-member-uuid",
  organization_id: ORG_ID,
  user_id: USER_ID,
  email: "owner@test.com",
  role: "owner",
  created_at: "2026-06-01T00:00:00Z",
};

async function buildApp(role = "owner") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(membersRoutes);
  return app;
}

// ── default state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockGetOrgMembersWithEmail.mockResolvedValue([mockOwnerMember, mockAgentMember]);
  mockGetMemberById.mockResolvedValue(mockAgentMember);
  mockUpdateMemberRole.mockResolvedValue({ ...mockAgentMember, role: "admin" });
  mockRemoveMember.mockResolvedValue(undefined);
  mockCreateAuditLog.mockResolvedValue({ id: "audit-uuid" });
});

// ── tests: GET /members ───────────────────────────────────────────────────────

describe("GET /organizations/:organizationId/members", () => {
  it("cenário 1: membro da org → 200 com lista e current_user_id", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/members`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.members).toHaveLength(2);
    expect(body.current_user_id).toBe(USER_ID);
    expect(mockGetOrgMembersWithEmail).toHaveBeenCalledWith(expect.anything(), ORG_ID);
  });

  it("cenário 2: não é membro da org → 403", async () => {
    mockAuthMiddleware.mockImplementation(async (request: any) => {
      request.user = {
        id: USER_ID,
        memberships: [{ organization_id: "outra-org", role: "owner" }],
      };
    });
    const app = Fastify({ logger: false });
    await app.register(membersRoutes);

    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/members`,
    });

    expect(res.statusCode).toBe(403);
    expect(mockGetOrgMembersWithEmail).not.toHaveBeenCalled();
  });

  it("cenário 3: role agent na org → 200 (agents também podem ver membros)", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${ORG_ID}/members`,
    });

    expect(res.statusCode).toBe(200);
  });
});

// ── tests: PATCH /members/:memberId ──────────────────────────────────────────

describe("PATCH /organizations/:organizationId/members/:memberId", () => {
  it("cenário 1: owner altera role de agent para admin → 200 com membro atualizado", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockUpdateMemberRole).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      MEMBER_ID,
      "admin"
    );
  });

  it("cenário 2: actor com role 'agent' → 403 sem alterar", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("cenário 3: alvo é owner → 403 sem alterar", async () => {
    mockGetMemberById.mockResolvedValue({ ...mockAgentMember, role: "owner" });

    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "agent" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("cenário 4: membro não encontrado → 404", async () => {
    mockGetMemberById.mockResolvedValue(null);

    const app = await buildApp("owner");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/inexistente`,
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(404);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("cenário 5: role inválido no body → 400", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "superadmin" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("admin não pode promover membro para owner", async () => {
    const app = await buildApp("admin");

    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: {
        role: "owner",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("admin não pode rebaixar outro admin", async () => {
    mockGetMemberById.mockResolvedValue({ ...mockAgentMember, role: "admin" });

    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "agent" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("admin não pode promover agent para admin", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("(audit): altera role com sucesso → registra member.role_changed", async () => {
    const app = await buildApp("owner");
    await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "admin" },
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "member.role_changed",
        entity_type: "member",
        entity_id: MEMBER_ID,
      })
    );
  });

  it("cenário 6: owner tenta alterar o próprio role → 403 sem alterar", async () => {
    // Target tem user_id igual ao actor — self-modification deve ser bloqueada
    mockGetMemberById.mockResolvedValue({
      ...mockAgentMember,
      user_id: USER_ID,
      role: "admin",
    });

    const app = await buildApp("owner");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
      payload: { role: "agent" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });
});

// ── tests: DELETE /members/:memberId ─────────────────────────────────────────

describe("DELETE /organizations/:organizationId/members/:memberId", () => {
  it("cenário 1: owner remove membro → 204", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
    });

    expect(res.statusCode).toBe(204);
    expect(mockRemoveMember).toHaveBeenCalledWith(expect.anything(), ORG_ID, MEMBER_ID);
  });

  it("cenário 2: actor admin → 403 sem remover", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it("cenário 3: alvo é owner → 403 sem remover", async () => {
    mockGetMemberById.mockResolvedValue({ ...mockAgentMember, role: "owner" });

    const app = await buildApp("owner");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it("cenário 4: membro não encontrado → 404", async () => {
    mockGetMemberById.mockResolvedValue(null);

    const app = await buildApp("owner");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/members/inexistente`,
    });

    expect(res.statusCode).toBe(404);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  it("(audit): remove membro com sucesso → registra member.removed", async () => {
    const app = await buildApp("owner");
    await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "member.removed",
        entity_type: "member",
        entity_id: MEMBER_ID,
      })
    );
  });

  it("cenário 5: owner tenta remover a própria membership → 403 sem remover", async () => {
    // Target tem user_id igual ao actor — self-removal deve ser bloqueada
    mockGetMemberById.mockResolvedValue({
      ...mockAgentMember,
      user_id: USER_ID,
      role: "admin",
    });

    const app = await buildApp("owner");
    const res = await app.inject({
      method: "DELETE",
      url: `/organizations/${ORG_ID}/members/${MEMBER_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });
});
