/**
 * V9 — x-organization-id deve ser validado como UUID antes do membership check.
 * header ausente   → comportamento atual (400 ou 403 dependendo da rota)
 * header invalido  → 400
 * header UUID sem membership → 403
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const { mockAuthMiddleware, mockGetAdminClient } = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../lib/audit", () => ({ fireAudit: vi.fn() }));

import flowRoutes from "../flows";
import stepRoutes from "../steps";

const VALID_ORG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const INVALID_ORG = "not-a-uuid";
const FLOW_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const STEP_ID = "11111111-1111-1111-1111-111111111111";

function makeDb() {
  const chainEnd = { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                     single: vi.fn().mockResolvedValue({ data: null, error: null }) };
  const eq2 = vi.fn().mockReturnValue(chainEnd);
  const eq1 = vi.fn().mockReturnValue({ eq: eq2, ...chainEnd });
  const order = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) });
  const select = vi.fn().mockReturnValue({ eq: eq1, order, ...chainEnd });
  return { from: vi.fn().mockReturnValue({ select }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  // User belongs to VALID_ORG only
  mockAuthMiddleware.mockImplementation(async (req: any) => {
    req.user = { id: "user-1", memberships: [{ organization_id: VALID_ORG, role: "admin" }] };
  });
});

// ── flows ──────────────────────────────────────────────────────────────────────

describe("V9 — flows: x-organization-id UUID validation", () => {
  async function buildFlowApp() {
    const app = Fastify({ logger: false });
    await app.register(flowRoutes);
    return app;
  }

  it("GET flows: header invalido → 400", async () => {
    const app = await buildFlowApp();
    const res = await app.inject({
      method: "GET",
      url: "/remarketing/flows",
      headers: { "x-organization-id": INVALID_ORG },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET flows: header UUID valido sem membership → 403", async () => {
    const OTHER_ORG = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const app = await buildFlowApp();
    const res = await app.inject({
      method: "GET",
      url: "/remarketing/flows",
      headers: { "x-organization-id": OTHER_ORG },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT flows/:id: header invalido → 400", async () => {
    const app = await buildFlowApp();
    const res = await app.inject({
      method: "PUT",
      url: `/remarketing/flows/${FLOW_ID}`,
      headers: { "x-organization-id": INVALID_ORG },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE flows/:id: header invalido → 400", async () => {
    const app = await buildFlowApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/remarketing/flows/${FLOW_ID}`,
      headers: { "x-organization-id": INVALID_ORG },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── steps ──────────────────────────────────────────────────────────────────────

describe("V9 — steps: x-organization-id UUID validation", () => {
  async function buildStepApp() {
    const app = Fastify({ logger: false });
    await app.register(stepRoutes);
    return app;
  }

  it("GET steps: header invalido → 400", async () => {
    const app = await buildStepApp();
    const res = await app.inject({
      method: "GET",
      url: `/remarketing/flows/${FLOW_ID}/steps`,
      headers: { "x-organization-id": INVALID_ORG },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET steps: header UUID valido sem membership → 403", async () => {
    const OTHER_ORG = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const app = await buildStepApp();
    const res = await app.inject({
      method: "GET",
      url: `/remarketing/flows/${FLOW_ID}/steps`,
      headers: { "x-organization-id": OTHER_ORG },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT steps/:stepId: header invalido → 400", async () => {
    const app = await buildStepApp();
    const res = await app.inject({
      method: "PUT",
      url: `/remarketing/flows/${FLOW_ID}/steps/${STEP_ID}`,
      headers: { "x-organization-id": INVALID_ORG },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE steps/:stepId: header invalido → 400", async () => {
    const app = await buildStepApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/remarketing/flows/${FLOW_ID}/steps/${STEP_ID}`,
      headers: { "x-organization-id": INVALID_ORG },
    });
    expect(res.statusCode).toBe(400);
  });
});
