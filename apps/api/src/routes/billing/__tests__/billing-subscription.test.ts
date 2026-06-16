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

/**
 * Creates a fully chainable Supabase query mock.
 * - `maybeSingle()` resolves with { data: result, error: null }
 * - `single()` resolves with { data: result, error: null }
 * - `eq()` can optionally be configured per table for count queries
 */
function makeFullChain(finalData: unknown, count?: number) {
  const countResult = { count: count ?? 0, data: null, error: null };
  const dataResult = { data: finalData, error: null };

  const chain: Record<string, unknown> = {};
  chain["select"] = vi.fn().mockReturnValue(chain);
  chain["eq"] = vi.fn().mockReturnValue(chain);
  chain["order"] = vi.fn().mockReturnValue(chain);
  chain["limit"] = vi.fn().mockResolvedValue(dataResult);
  chain["maybeSingle"] = vi.fn().mockResolvedValue(dataResult);
  chain["single"] = vi.fn().mockResolvedValue(dataResult);
  // For count queries — the resolved value of the chain itself (when awaited)
  // We make .eq() conditionally return a promise so head:true queries work
  chain["then"] = undefined; // not a thenable by default
  return chain;
}

/** Creates a chain for count-style queries (select + eq resolves to count) */
function makeCountChain(count: number) {
  // Supabase count queries: .select('*', { count:'exact', head:true }).eq(...)
  // The chain must return a promise when awaited (i.e., when .eq() is the last call)
  const result = { count, data: null, error: null };
  const eqFn = vi.fn().mockResolvedValue(result);
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  return { select: selectFn };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(billingRoutes);
  return app;
}

// ── default mock state ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default auth: owner of org-1
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

  // Default db: no subscription, zero counts, no events
  mockGetAdminClient.mockReturnValue({
    from: vi.fn((_table: string) => makeFullChain(null, 0)),
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
    const mockFrom = vi.fn((table: string) => {
      if (table === "subscriptions") return makeFullChain(null);
      if (table === "agents") return makeCountChain(2);
      if (table === "organization_members") return makeCountChain(3);
      if (table === "evolution_instances") return makeCountChain(1);
      if (table === "billing_events") {
        // owner role — returns empty array
        const chain: Record<string, unknown> = {};
        chain["select"] = vi.fn().mockReturnValue(chain);
        chain["eq"] = vi.fn().mockReturnValue(chain);
        chain["order"] = vi.fn().mockReturnValue(chain);
        chain["limit"] = vi.fn().mockResolvedValue({ data: [], error: null });
        return chain;
      }
      return makeFullChain(null);
    });

    mockGetAdminClient.mockReturnValue({ from: mockFrom });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: {
        authorization: "Bearer token-x",
        "x-organization-id": "org-1",
      },
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

  it("cenário 3: org com assinatura — retorna subscription, plan, usage, recentEvents", async () => {
    const mockSubscription = {
      id: "sub-1",
      organization_id: "org-1",
      plan_id: "plan-pro",
      status: "active",
      billing_interval: "monthly",
    };
    const mockPlan = {
      id: "plan-pro",
      name: "Pro",
      slug: "pro",
      max_agents: 5,
      max_members: 10,
      max_instances: 3,
    };
    const mockEvents = [
      { id: "evt-1", organization_id: "org-1", event_type: "subscription.created" },
      { id: "evt-2", organization_id: "org-1", event_type: "payment.approved" },
    ];

    const mockFrom = vi.fn((table: string) => {
      if (table === "subscriptions") return makeFullChain(mockSubscription);
      if (table === "plans") return makeFullChain(mockPlan);
      if (table === "agents") return makeCountChain(4);
      if (table === "organization_members") return makeCountChain(2);
      if (table === "evolution_instances") return makeCountChain(1);
      if (table === "billing_events") {
        const chain: Record<string, unknown> = {};
        chain["select"] = vi.fn().mockReturnValue(chain);
        chain["eq"] = vi.fn().mockReturnValue(chain);
        chain["order"] = vi.fn().mockReturnValue(chain);
        chain["limit"] = vi.fn().mockResolvedValue({ data: mockEvents, error: null });
        return chain;
      }
      return makeFullChain(null);
    });

    mockGetAdminClient.mockReturnValue({ from: mockFrom });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: {
        authorization: "Bearer token-x",
        "x-organization-id": "org-1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.subscription).toMatchObject({ id: "sub-1", status: "active" });
    expect(body.plan).toMatchObject({ id: "plan-pro", name: "Pro" });
    expect(body.usage).toEqual({ agents_used: 4, members_used: 2, instances_used: 1 });
    expect(body.limits).toEqual({ max_agents: 5, max_members: 10, max_instances: 3 });
    expect(body.recentEvents).toHaveLength(2);
    expect(body.recentEvents[0].id).toBe("evt-1");
  });

  it("cenário 4: role agent — retorna recentEvents: [] mesmo com eventos no banco", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockRequireOrg as any).mockImplementation(async (req: any) => {
      req.organizationId = "org-1";
      req.userRole = "agent";
    });

    const mockSubscription = {
      id: "sub-1",
      organization_id: "org-1",
      plan_id: "plan-pro",
      status: "active",
    };
    const mockPlan = {
      id: "plan-pro",
      name: "Pro",
      slug: "pro",
      max_agents: 5,
      max_members: 10,
      max_instances: 3,
    };

    const billingEventsChain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: "evt-secret" }], error: null }),
    };

    const mockFrom = vi.fn((table: string) => {
      if (table === "subscriptions") return makeFullChain(mockSubscription);
      if (table === "plans") return makeFullChain(mockPlan);
      if (table === "agents") return makeCountChain(1);
      if (table === "organization_members") return makeCountChain(1);
      if (table === "evolution_instances") return makeCountChain(1);
      if (table === "billing_events") return billingEventsChain;
      return makeFullChain(null);
    });

    mockGetAdminClient.mockReturnValue({ from: mockFrom });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/billing/subscription",
      headers: {
        authorization: "Bearer token-x",
        "x-organization-id": "org-1",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recentEvents).toEqual([]);
    // billing_events table should NOT have been queried
    expect(mockFrom).not.toHaveBeenCalledWith("billing_events");
  });
});
