import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetAdminClient, mockAuthMiddleware, mockRequireOrg } = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn(),
  mockAuthMiddleware: vi.fn(async () => {}),
  mockRequireOrg: vi.fn(async () => {}),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
  requireOrg: mockRequireOrg,
}));

import billingRoutes from "../index";

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(billingRoutes);
  return app;
}

const mockPlans = [
  {
    id: "plan-free",
    name: "Free",
    slug: "free",
    price_monthly: 0,
    price_yearly: 0,
    currency: "BRL",
    max_agents: 1,
    max_instances: 1,
    max_members: 1,
    features: ["1 agente", "1 instância"],
    is_active: true,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "plan-pro",
    name: "Pro",
    slug: "pro",
    price_monthly: 9900,
    price_yearly: 99000,
    currency: "BRL",
    max_agents: 10,
    max_instances: 5,
    max_members: 10,
    features: ["10 agentes", "5 instâncias", "Suporte prioritário"],
    is_active: true,
    sort_order: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

function makePlansChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["eq"]     = vi.fn().mockReturnValue(chain);
  chain["order"]  = vi.fn().mockResolvedValue(result);
  return chain;
}

// ── default mock state ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockAuthMiddleware as any).mockImplementation(async (req: any) => {
    req.user = { id: "user-1", email: "u@test.com", memberships: [] };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockRequireOrg as any).mockImplementation(async (req: any) => {
    req.organizationId = "org-1";
    req.userRole = "owner";
  });

  mockGetAdminClient.mockReturnValue({
    from: vi.fn().mockReturnValue(makePlansChain({ data: mockPlans, error: null })),
  });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /billing/plans", () => {
  it("cenário 1: sem auth → authMiddleware retorna 401", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockAuthMiddleware as any).mockImplementation(async (_req: any, reply: any) => {
      return reply.status(401).send({ error: "Unauthorized" });
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/plans",
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/Unauthorized/);
  });

  it("cenário 2: autenticado → retorna array de planos ativos com campos esperados", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/plans",
      headers: { authorization: "Bearer token-x" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    const freePlan = body[0];
    expect(freePlan.id).toBe("plan-free");
    expect(freePlan.name).toBe("Free");
    expect(freePlan.slug).toBe("free");
    expect(freePlan.max_agents).toBe(1);
    expect(freePlan.max_instances).toBe(1);
    expect(freePlan.max_members).toBe(1);
    expect(freePlan.price_monthly).toBe(0);
    expect(freePlan.is_active).toBe(true);

    const proPlan = body[1];
    expect(proPlan.id).toBe("plan-pro");
    expect(proPlan.name).toBe("Pro");
    expect(proPlan.slug).toBe("pro");
    expect(proPlan.max_agents).toBe(10);
    expect(proPlan.max_instances).toBe(5);
    expect(proPlan.max_members).toBe(10);
    expect(proPlan.price_monthly).toBe(9900);
    expect(proPlan.is_active).toBe(true);
  });

  it("cenário 3: erro no banco → retorna 500", async () => {
    mockGetAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(makePlansChain({ data: null, error: new Error("db error") })),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/plans",
      headers: { authorization: "Bearer token-x" },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/Failed to fetch plans/);
  });

  it("cenário 4: role agent → retorna 403 sem chamar o banco", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockRequireOrg as any).mockImplementation(async (req: any) => {
      req.organizationId = "org-1";
      req.userRole = "agent";
    });

    const mockFrom = vi.fn();
    mockGetAdminClient.mockReturnValue({ from: mockFrom });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/plans",
      headers: { authorization: "Bearer token-x", "x-organization-id": "org-1" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("cenário 5: query throws erro inesperado → retorna 500", async () => {
    mockGetAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockRejectedValue(new Error("unexpected network error")),
          }),
        }),
      }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/plans",
      headers: { authorization: "Bearer token-x" },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/Failed to fetch plans/);
  });
});
