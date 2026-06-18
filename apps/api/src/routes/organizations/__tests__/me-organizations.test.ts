import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockGetUserOrganizations, mockAuthMiddleware } = vi.hoisted(() => ({
  mockGetUserOrganizations: vi.fn(),
  mockAuthMiddleware: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getUserOrganizations: mockGetUserOrganizations,
  getOrganizationById: vi.fn(),
  updateOrganizationName: vi.fn(),
  completeOrganizationOnboarding: vi.fn(),
  deleteInstance: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("../../instances", () => ({ default: async () => {} }));

import organizationRoutes from "../index";

const USER_ID = "user-uuid-1";
const ORG_ID_1 = "org-uuid-1";
const ORG_ID_2 = "org-uuid-2";

const MEMBERSHIPS_FIXTURE = [
  { organization_id: ORG_ID_1, role: "owner", organizations: { id: ORG_ID_1, name: "Org 1", slug: "org-1" } },
  { organization_id: ORG_ID_2, role: "member", organizations: { id: ORG_ID_2, name: "Org 2", slug: "org-2" } },
];

function buildApp() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      email: "user@test.com",
      memberships: [
        { organization_id: ORG_ID_1, role: "owner" },
        { organization_id: ORG_ID_2, role: "member" },
      ],
    };
  });
  const app = Fastify({ logger: false });
  return app.register(organizationRoutes).then(() => app);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /me/organizations", () => {
  it("retorna organizações do usuário autenticado", async () => {
    mockGetUserOrganizations.mockResolvedValue(MEMBERSHIPS_FIXTURE);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/me/organizations" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(ORG_ID_1);
  });

  it("chama getUserOrganizations com user.id do token", async () => {
    mockGetUserOrganizations.mockResolvedValue(MEMBERSHIPS_FIXTURE);
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/me/organizations" });
    expect(mockGetUserOrganizations).toHaveBeenCalledWith(expect.anything(), USER_ID);
  });

  it("retorna array vazio quando usuário não tem organizações", async () => {
    mockGetUserOrganizations.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/me/organizations" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
