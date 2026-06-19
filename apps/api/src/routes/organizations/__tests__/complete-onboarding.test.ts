import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetOrganizationById,
  mockIsSlugAvailableForOrg,
  mockCompleteOrganizationOnboarding,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetOrganizationById: vi.fn(),
  mockIsSlugAvailableForOrg: vi.fn(),
  mockCompleteOrganizationOnboarding: vi.fn(),
  mockCreateAuditLog: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getOrganizationById: mockGetOrganizationById,
  isSlugAvailableForOrg: mockIsSlugAvailableForOrg,
  completeOrganizationOnboarding: mockCompleteOrganizationOnboarding,
  createAuditLog: mockCreateAuditLog,
  updateOrganizationName: vi.fn(),
}));

import organizationRoutes from "../index";

// ── helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

const mockOrg = {
  id: ORG_ID,
  name: "Empresa Teste",
  slug: "empresa-teste",
  plan: "pro",
  plan_id: "plan-uuid-1",
  onboarding_status: "active" as const,
  settings: { max_documents: 10, max_agents: 5, max_instances: 3 },
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

async function buildApp(userId = USER_ID, memberships = [{ organization_id: ORG_ID, role: "owner" }]) {
  const app = Fastify({ logger: false });

  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: userId, email: "owner@test.com", memberships };
  });

  await app.register(organizationRoutes);
  return app;
}

// ── default state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockGetOrganizationById.mockResolvedValue(mockOrg);
  mockIsSlugAvailableForOrg.mockResolvedValue(true);
  mockCompleteOrganizationOnboarding.mockResolvedValue({
    ...mockOrg,
    name: "Novo Nome",
    slug: "novo-nome",
  });
  mockCreateAuditLog.mockResolvedValue({ id: "audit-uuid" });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PATCH /organizations/:organizationId/onboarding", () => {
  it("cenário 1: owner válido → 200 com org atualizada", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Novo Nome", slug: "novo-nome" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("Novo Nome");
    expect(body.slug).toBe("novo-nome");

    expect(mockCompleteOrganizationOnboarding).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      "Novo Nome",
      "novo-nome"
    );
  });

  it("cenário 2: não-owner → 403", async () => {
    const app = await buildApp(USER_ID, [{ organization_id: ORG_ID, role: "admin" }]);
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Novo Nome", slug: "novo-nome" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockCompleteOrganizationOnboarding).not.toHaveBeenCalled();
  });

  it("cenário 3: usuário não é membro da org → 403", async () => {
    // User has no memberships for this org
    const app = await buildApp(USER_ID, [{ organization_id: "outra-org", role: "owner" }]);
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Novo Nome", slug: "novo-nome" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("cenário 4: slug já usado por outra org → 409", async () => {
    mockIsSlugAvailableForOrg.mockResolvedValue(false);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Novo Nome", slug: "slug-existente" },
    });

    expect(res.statusCode).toBe(409);
    expect(mockCompleteOrganizationOnboarding).not.toHaveBeenCalled();
  });

  it("cenário 5: mesmo slug da própria org → 200 (não é conflito)", async () => {
    // isSlugAvailableForOrg exclui a própria org — retorna true
    mockIsSlugAvailableForOrg.mockResolvedValue(true);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Empresa Teste", slug: "empresa-teste" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("cenário 6: slug com formato inválido → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Novo Nome", slug: "Slug Com Espaços!" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCompleteOrganizationOnboarding).not.toHaveBeenCalled();
  });

  it("cenário 7: name vazio → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "", slug: "novo-nome" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCompleteOrganizationOnboarding).not.toHaveBeenCalled();
  });

  it("cenário 8: org não encontrada → 404", async () => {
    mockGetOrganizationById.mockRejectedValue(new Error("not found"));

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/org-inexistente/onboarding`,
      payload: { name: "Novo Nome", slug: "novo-nome" },
    });

    // 403 because the user is not an owner of 'org-inexistente' (not in memberships)
    expect(res.statusCode).toBe(403);
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
  });

  it("cenário 9: owner da org mas org não existe no banco → 404", async () => {
    // Membership says owner, but DB throws (e.g. org was deleted between middleware and query)
    mockGetOrganizationById.mockRejectedValue(new Error("not found"));

    const app = await buildApp(USER_ID, [{ organization_id: "deleted-org", role: "owner" }]);
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/deleted-org/onboarding`,
      payload: { name: "Novo Nome", slug: "novo-nome" },
    });

    expect(res.statusCode).toBe(404);
    expect(mockCompleteOrganizationOnboarding).not.toHaveBeenCalled();
  });

  it("(audit): onboarding concluído → registra organization.onboarding_completed", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Novo Nome", slug: "novo-nome" },
    });

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organization_id: ORG_ID,
        user_id: USER_ID,
        action: "organization.onboarding_completed",
        entity_type: "organization",
        entity_id: ORG_ID,
      })
    );
  });

  it("cenário 11: erro no banco (update) → 500", async () => {
    mockCompleteOrganizationOnboarding.mockRejectedValue(new Error("db error"));

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}/onboarding`,
      payload: { name: "Novo Nome", slug: "novo-nome" },
    });

    expect(res.statusCode).toBe(500);
  });
});
