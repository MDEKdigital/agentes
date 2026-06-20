import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  createAuditLog: mockCreateAuditLog,
}));

import remarketingFlowRoutes from "../flows";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const FLOW_ID = "00000000-0000-0000-0000-000000000002";
const STEP_ID = "00000000-0000-0000-0000-000000000003";
const USER_ID = "00000000-0000-0000-0000-000000000004";
const AGENT_ID = "00000000-0000-0000-0000-000000000005";
const INST_ID = "00000000-0000-0000-0000-000000000006";

const mockFlow = {
  id: FLOW_ID,
  organization_id: ORG_ID,
  name: "Fluxo Teste",
  product_campaign: "Produto X",
  agent_id: AGENT_ID,
  instance_id: INST_ID,
  entry_silence_minutes: 60,
  status: "inactive",
  remarketing_steps: [],
};

function makeDb(flowExists = true, agentExists = true, instanceExists = true, activeEnrollments = 0) {
  return {
    from: vi.fn((table: string) => {
      if (table === "remarketing_flows") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: flowExists ? mockFlow : null }),
                single: vi.fn().mockResolvedValue({ data: flowExists ? mockFlow : null }),
                order: vi.fn().mockResolvedValue({ data: [mockFlow], error: null }),
              }),
              order: vi.fn().mockResolvedValue({ data: [mockFlow], error: null }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockFlow, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockFlow, error: null }),
                }),
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      if (table === "agents") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: agentExists ? { id: AGENT_ID } : null }),
              }),
            }),
          }),
        };
      }
      if (table === "evolution_instances") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: instanceExists ? { id: INST_ID } : null }),
              }),
            }),
          }),
        };
      }
      if (table === "remarketing_enrollments") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ count: activeEnrollments, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      if (table === "remarketing_steps") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
    }),
  };
}

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role }] };
  });
  const app = Fastify({ logger: false });
  await app.register(remarketingFlowRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockCreateAuditLog.mockResolvedValue({});
});

describe("Audit logs — remarketing flows", () => {
  it("remarketing_flow.created é auditado ao criar fluxo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/remarketing/flows",
      headers: { "x-organization-id": ORG_ID },
      payload: {
        name: "Fluxo Teste",
        product_campaign: "Produto X",
        agent_id: AGENT_ID,
        instance_id: INST_ID,
        entry_silence_minutes: 60,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_flow.created",
        entity_type: "remarketing_flow",
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("remarketing_flow.updated é auditado ao atualizar fluxo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/remarketing/flows/${FLOW_ID}`,
      headers: { "x-organization-id": ORG_ID },
      payload: { name: "Fluxo Atualizado" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_flow.updated",
        entity_type: "remarketing_flow",
        entity_id: FLOW_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("remarketing_flow.deleted é auditado ao deletar fluxo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/remarketing/flows/${FLOW_ID}`,
      headers: { "x-organization-id": ORG_ID },
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_flow.deleted",
        entity_type: "remarketing_flow",
        entity_id: FLOW_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("remarketing_flow.duplicated é auditado ao duplicar fluxo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/remarketing/flows/${FLOW_ID}/duplicate`,
      headers: { "x-organization-id": ORG_ID },
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_flow.duplicated",
        entity_type: "remarketing_flow",
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("remarketing_flow.status_changed é auditado ao alterar status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/remarketing/flows/${FLOW_ID}/status`,
      headers: { "x-organization-id": ORG_ID },
      payload: { status: "active" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_flow.status_changed",
        entity_type: "remarketing_flow",
        entity_id: FLOW_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
        metadata: expect.objectContaining({ status: "active" }),
      })
    );
  });
});
