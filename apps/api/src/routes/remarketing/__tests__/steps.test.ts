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

import remarketingStepRoutes from "../steps";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const FLOW_ID = "00000000-0000-0000-0000-000000000002";
const STEP_ID = "00000000-0000-0000-0000-000000000003";
const USER_ID = "00000000-0000-0000-0000-000000000004";

const mockFlow = { id: FLOW_ID, organization_id: ORG_ID };
const mockStep = {
  id: STEP_ID,
  flow_id: FLOW_ID,
  step_order: 1,
  delay_value: 60,
  delay_unit: "minutes",
  message_type: "text",
  message_content: "Olá!",
  is_active: true,
};

function makeDb(flowExists = true, stepExists = true) {
  return {
    from: vi.fn((table: string) => {
      if (table === "remarketing_flows") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: flowExists ? mockFlow : null }),
              }),
            }),
          }),
        };
      }
      if (table === "remarketing_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: stepExists ? mockStep : null }),
                order: vi.fn().mockResolvedValue({ data: [mockStep], error: null }),
              }),
              order: vi.fn().mockResolvedValue({ data: [mockStep], error: null }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockStep, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockStep, error: null }),
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
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
    }),
  };
}

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role }] };
  });
  const app = Fastify({ logger: false });
  await app.register(remarketingStepRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockCreateAuditLog.mockResolvedValue({});
});

describe("Audit logs — remarketing steps", () => {
  it("remarketing_step.created é auditado ao criar etapa", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/remarketing/flows/${FLOW_ID}/steps`,
      headers: { "x-organization-id": ORG_ID },
      payload: {
        step_order: 1,
        delay_value: 60,
        delay_unit: "minutes",
        message_type: "text",
        message_content: "Olá!",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_step.created",
        entity_type: "remarketing_step",
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("remarketing_step.updated é auditado ao atualizar etapa", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/remarketing/flows/${FLOW_ID}/steps/${STEP_ID}`,
      headers: { "x-organization-id": ORG_ID },
      payload: { message_content: "Nova mensagem" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_step.updated",
        entity_type: "remarketing_step",
        entity_id: STEP_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("remarketing_step.deleted é auditado ao deletar etapa", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/remarketing/flows/${FLOW_ID}/steps/${STEP_ID}`,
      headers: { "x-organization-id": ORG_ID },
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_step.deleted",
        entity_type: "remarketing_step",
        entity_id: STEP_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("remarketing_step.status_changed é auditado ao alterar status da etapa", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/remarketing/flows/${FLOW_ID}/steps/${STEP_ID}/status`,
      headers: { "x-organization-id": ORG_ID },
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "remarketing_step.status_changed",
        entity_type: "remarketing_step",
        entity_id: STEP_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
        metadata: expect.objectContaining({ is_active: false }),
      })
    );
  });
});
