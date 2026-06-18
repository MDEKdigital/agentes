import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockUpdateOrganizationName,
  mockDeleteInstance,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(() => ({})),
  mockUpdateOrganizationName: vi.fn(),
  mockDeleteInstance: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getOrganizationById: vi.fn(),
  isSlugAvailableForOrg: vi.fn(),
  completeOrganizationOnboarding: vi.fn(),
  updateOrganizationName: mockUpdateOrganizationName,
}));

vi.mock("../../../services/evolution.service", () => ({
  deleteInstance: mockDeleteInstance,
}));

import organizationRoutes from "../index";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

const mockUpdatedOrg = {
  id: ORG_ID,
  name: "Novo Nome",
  slug: "empresa-teste",
  created_at: "2026-01-01T00:00:00Z",
};

async function buildApp(role = "owner") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = {
      id: USER_ID,
      memberships: [{ organization_id: ORG_ID, role }],
    };
  });
  const app = Fastify({ logger: false });
  await app.register(organizationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue({});
  mockUpdateOrganizationName.mockResolvedValue(mockUpdatedOrg);
});

describe("PATCH /organizations/:organizationId", () => {
  it("owner atualiza nome → 200 com org atualizada", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}`,
      payload: { name: "Novo Nome" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("Novo Nome");
    expect(mockUpdateOrganizationName).toHaveBeenCalledWith(expect.anything(), ORG_ID, "Novo Nome");
  });

  it("admin → 403 sem atualizar", async () => {
    const app = await buildApp("admin");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}`,
      payload: { name: "Novo Nome" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateOrganizationName).not.toHaveBeenCalled();
  });

  it("agent → 403 sem atualizar", async () => {
    const app = await buildApp("agent");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}`,
      payload: { name: "Novo Nome" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockUpdateOrganizationName).not.toHaveBeenCalled();
  });

  it("nome vazio → 400 sem atualizar", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}`,
      payload: { name: "   " },
    });

    expect(res.statusCode).toBe(400);
    expect(mockUpdateOrganizationName).not.toHaveBeenCalled();
  });

  it("nome ausente → 400 sem atualizar", async () => {
    const app = await buildApp("owner");
    const res = await app.inject({
      method: "PATCH",
      url: `/organizations/${ORG_ID}`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(mockUpdateOrganizationName).not.toHaveBeenCalled();
  });
});
