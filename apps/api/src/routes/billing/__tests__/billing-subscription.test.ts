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

/** Chain for queries that end with .maybeSingle() or .single() */
function makeDataChain(data: unknown) {
  const result = { data, error: null };
  const chain: Record<string, unknown> = {};
  chain["select"]      = vi.fn().mockReturnValue(chain);
  chain["eq"]          = vi.fn().mockReturnValue(chain);
  chain["order"]       = vi.fn().mockReturnValue(chain);
  chain["limit"]       = vi.fn().mockResolvedValue(result);
  chain["abortSignal"] = vi.fn().mockReturnValue(chain);
  chain["maybeSingle"] = vi.fn().mockResolvedValue(result);
  chain["single"]      = vi.fn().mockResolvedValue(result);
  return chain;
}

/** Chain for count-style queries (.select('*', {count:'exact',head:true}).eq(...))
 *  eq() is the terminal method — it must be a thenable. */
function makeCountChain(count: number | null, error: object | null = null) {
  const result = { count, data: null, error };
  const chain: Record<string, unknown> = {};
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["eq"]     = vi.fn().mockResolvedValue(result);
  return chain;
}

/** Chain for billing_events: ends with .limit()
 *  limit() is the terminal method — it must be a thenable. */
function makeEventsChain(events: unknown[]) {
  const result = { data: events, error: null };
  const chain: Record<string, unknown> = {};
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["eq"]     = vi.fn().mockReturnValue(chain);
  chain["order"]  = vi.fn().mockReturnValue(chain);
  chain["limit"]  = vi.fn().mockResolvedValue(result);
  return chain;
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(billingRoutes);
  return app;
}

// ── default mock state ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockAuthMiddleware as any).mockImplementation(async (req: any) => {
    req.user = {
      id: "user-1",
      email: "u@test.com",
      memberships: [{ organization_id: "org-1", role: "owner" }],
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockRequireOrg as any).mockImplementation(async (req: any) => {
    req.organizationId = "org-1";
    req.userRole = "owner";
  });

  // Default: no subscription, zero counts, no events
  mockGetAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "subscriptions")        return makeDataChain(null);
      if (table === "agents")               return makeCountChain(0);
      if (table === "organization_members") return makeCountChain(0);
      if (table === "evolution_instances")  return makeCountChain(0);
      if (table === "billing_events")       return makeEventsChain([]);
      return makeDataChain(null);
    }),
  });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /billing/subscription", () => {
  it("cenário 1: requireOrg retorna 400 quando x-organization-id ausente", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockRequireOrg as any).mockImplementation(async (_req: any, reply: any) => {
      return reply.status(400).send({ error: "Missing organization ID" });
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: { authorization: "Bearer token-x" },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Missing organization ID/);
  });

  it("cenário 2: org sem assinatura — retorna subscription: null, plan: null, limits: null, recentEvents: []", async () => {
    mockGetAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "subscriptions")        return makeDataChain(null);
        if (table === "agents")               return makeCountChain(2);
        if (table === "organization_members") return makeCountChain(3);
        if (table === "evolution_instances")  return makeCountChain(1);
        if (table === "billing_events")       return makeEventsChain([]);
        return makeDataChain(null);
      }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: { authorization: "Bearer token-x", "x-organization-id": "org-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.subscription).toBeNull();
    expect(body.plan).toBeNull();
    expect(body.limits).toBeNull();
    expect(body.usage.agents_used).toBe(2);
    expect(body.usage.members_used).toBe(3);
    expect(body.usage.instances_used).toBe(1);
    expect(body.recentEvents).toEqual([]);
  });

  it("cenário 3: org com assinatura — retorna subscription, plan embutido, usage, recentEvents", async () => {
    // subscription row now includes the joined plan under `plans`
    const mockPlan = {
      id: "plan-pro",
      name: "Pro",
      slug: "pro",
      max_agents: 5,
      max_members: 10,
      max_instances: 3,
      features: [],
      is_active: true,
    };
    const mockSubRow = {
      id: "sub-1",
      organization_id: "org-1",
      plan_id: "plan-pro",
      status: "active",
      billing_interval: "monthly",
      plans: mockPlan,
    };
    const mockEvents = [
      { id: "evt-1", organization_id: "org-1", event_type: "subscription.activated" },
      { id: "evt-2", organization_id: "org-1", event_type: "subscription.renewed" },
    ];

    mockGetAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "subscriptions")        return makeDataChain(mockSubRow);
        if (table === "agents")               return makeCountChain(4);
        if (table === "organization_members") return makeCountChain(2);
        if (table === "evolution_instances")  return makeCountChain(1);
        if (table === "billing_events")       return makeEventsChain(mockEvents);
        return makeDataChain(null);
      }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: { authorization: "Bearer token-x", "x-organization-id": "org-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.subscription).toMatchObject({ id: "sub-1", status: "active" });
    expect(body.subscription.plans).toBeUndefined(); // stripped out
    expect(body.plan).toMatchObject({ id: "plan-pro", name: "Pro" });
    expect(body.usage).toEqual({ agents_used: 4, members_used: 2, instances_used: 1 });
    expect(body.limits).toEqual({ max_agents: 5, max_members: 10, max_instances: 3 });
    expect(body.recentEvents).toHaveLength(2);
    expect(body.recentEvents[0].id).toBe("evt-1");
  });

  it("cenário 4: role agent — retorna 403 (acesso restrito a administradores)", async () => {
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
      url: "/billing/subscription",
      headers: { authorization: "Bearer token-x", "x-organization-id": "org-1" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled(); // nenhuma query ao banco para agentes
  });

  it("cenário 5: subscription query falha — retorna 503", async () => {
    // Simulate the subscriptions chain rejecting (e.g. AbortError on timeout)
    function makeFailChain(err: Error) {
      const chain: Record<string, unknown> = {};
      const reject = vi.fn().mockRejectedValue(err);
      chain["select"]      = vi.fn().mockReturnValue(chain);
      chain["eq"]          = vi.fn().mockReturnValue(chain);
      chain["maybeSingle"] = reject;
      chain["single"]      = reject;
      return chain;
    }

    mockGetAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "subscriptions")        return makeFailChain(new Error("AbortError"));
        if (table === "agents")               return makeCountChain(0);
        if (table === "organization_members") return makeCountChain(0);
        if (table === "evolution_instances")  return makeCountChain(0);
        if (table === "billing_events")       return makeEventsChain([]);
        return makeDataChain(null);
      }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: { authorization: "Bearer token-x", "x-organization-id": "org-1" },
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toMatch(/temporariamente indisponível/);
  });

  it("cenário 6: count query fulfills com error — usage retorna 0 e não mascara o erro silenciosamente", async () => {
    const permissionError = { message: "permission denied", code: "42501" };

    mockGetAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "subscriptions")        return makeDataChain(null);
        if (table === "agents")               return makeCountChain(null, permissionError);
        if (table === "organization_members") return makeCountChain(null, permissionError);
        if (table === "evolution_instances")  return makeCountChain(null, permissionError);
        if (table === "billing_events")       return makeEventsChain([]);
        return makeDataChain(null);
      }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: { authorization: "Bearer token-x", "x-organization-id": "org-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.usage.agents_used).toBe(0);
    expect(body.usage.members_used).toBe(0);
    expect(body.usage.instances_used).toBe(0);
  });

  it("cenário 7: plans retornado como array pelo Supabase — extrai primeiro elemento", async () => {
    const mockPlan = { id: "plan-pro", name: "Pro", max_agents: 5, max_members: 10, max_instances: 3 };
    const mockSubRow = {
      id: "sub-1",
      organization_id: "org-1",
      plan_id: "plan-pro",
      status: "active",
      plans: [mockPlan],
    };

    mockGetAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "subscriptions")        return makeDataChain(mockSubRow);
        if (table === "agents")               return makeCountChain(0);
        if (table === "organization_members") return makeCountChain(0);
        if (table === "evolution_instances")  return makeCountChain(0);
        if (table === "billing_events")       return makeEventsChain([]);
        return makeDataChain(null);
      }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: { authorization: "Bearer token-x", "x-organization-id": "org-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.plan).toMatchObject({ id: "plan-pro", name: "Pro" });
    expect(body.limits).toMatchObject({ max_agents: 5, max_members: 10, max_instances: 3 });
  });
});
