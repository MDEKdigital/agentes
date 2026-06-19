import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const {
  mockGetAdminClient,
  mockGetActiveRemarketingFlows,
  mockGetConversationsEligibleForEnrollment,
  mockGetFirstActiveStep,
  mockCreateEnrollment,
  mockGetActiveEnrollments,
  mockGetStepById,
  mockGetRemarketingFlowsByIds,
  mockGetRemarketingStepsByIds,
  mockCancelEnrollment,
  mockAdvanceEnrollment,
  mockUpdateFlowLastExecuted,
  mockIsConversationResolved,
  mockHasContactRepliedSince,
  mockGetLastContactMessage,
  mockIsOptOutMessage,
  mockGetConversationById,
  mockGetNextActiveStep,
  mockReturnConversationToAgent,
  mockQueueAdd,
  mockGetSendMessageQueue,
  mockGetRemarketingQueue,
} = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn(),
  mockGetActiveRemarketingFlows: vi.fn(),
  mockGetConversationsEligibleForEnrollment: vi.fn(),
  mockGetFirstActiveStep: vi.fn(),
  mockCreateEnrollment: vi.fn(),
  mockGetActiveEnrollments: vi.fn(),
  mockGetStepById: vi.fn(),
  mockGetRemarketingFlowsByIds: vi.fn(),
  mockGetRemarketingStepsByIds: vi.fn(),
  mockCancelEnrollment: vi.fn(),
  mockAdvanceEnrollment: vi.fn(),
  mockUpdateFlowLastExecuted: vi.fn(),
  mockIsConversationResolved: vi.fn(),
  mockHasContactRepliedSince: vi.fn(),
  mockGetLastContactMessage: vi.fn(),
  mockIsOptOutMessage: vi.fn(),
  mockGetConversationById: vi.fn(),
  mockGetNextActiveStep: vi.fn(),
  mockReturnConversationToAgent: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockGetSendMessageQueue: vi.fn(),
  mockGetRemarketingQueue: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getActiveRemarketingFlows: mockGetActiveRemarketingFlows,
  getConversationsEligibleForEnrollment: mockGetConversationsEligibleForEnrollment,
  getFirstActiveStep: mockGetFirstActiveStep,
  createEnrollment: mockCreateEnrollment,
  getActiveEnrollments: mockGetActiveEnrollments,
  getStepById: mockGetStepById,
  getRemarketingFlowsByIds: mockGetRemarketingFlowsByIds,
  getRemarketingStepsByIds: mockGetRemarketingStepsByIds,
  cancelEnrollment: mockCancelEnrollment,
  advanceEnrollment: mockAdvanceEnrollment,
  updateFlowLastExecuted: mockUpdateFlowLastExecuted,
  isConversationResolved: mockIsConversationResolved,
  hasContactRepliedSince: mockHasContactRepliedSince,
  getLastContactMessage: mockGetLastContactMessage,
  isOptOutMessage: mockIsOptOutMessage,
  getConversationById: mockGetConversationById,
  getNextActiveStep: mockGetNextActiveStep,
  returnConversationToAgent: mockReturnConversationToAgent,
}));

vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: mockGetSendMessageQueue,
  getRemarketingQueue: mockGetRemarketingQueue,
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  })),
}));

vi.mock("../../../lib/redis", () => ({
  getConnectionOptions: vi.fn().mockReturnValue({}),
}));

import { processRemarketingCycle } from "../remarketing-worker";

// ── fixtures ───────────────────────────────────────────────────────────────────

const FLOW_1_ID = "flow-uuid-1";
const FLOW_2_ID = "flow-uuid-2";
const STEP_1_ID = "step-uuid-1";
const STEP_2_ID = "step-uuid-2";
const STEP_3_ID = "step-uuid-3";

// Far in the past so timer is always ready
const PAST = "2020-01-01T00:00:00.000Z";

const makeFlow = (id: string, overrides = {}) => ({
  id,
  organization_id: "org-1",
  agent_id: "agent-1",
  instance_id: "inst-1",
  status: "active",
  cancel_on_reply: false,
  cancel_on_resolved: true,
  cancel_on_opt_out: false,
  entry_silence_minutes: 15,
  ...overrides,
});

const makeStep = (id: string, flowId: string) => ({
  id,
  flow_id: flowId,
  step_order: 1,
  delay_value: 1,
  delay_unit: "minutes",
  message_type: "text",
  message_content: "Olá!",
  is_active: true,
});

const makeEnrollment = (id: string, flowId: string, stepId: string) => ({
  id,
  flow_id: flowId,
  conversation_id: `conv-${id}`,
  organization_id: "org-1",
  next_step_id: stepId,
  enrolled_at: PAST,
  last_step_sent_at: null,
  status: "active",
});

const makeConversation = (id: string) => ({
  id,
  organization_id: "org-1",
  evolution_instance_id: "inst-1",
  contacts: { phone: "5511999999999", name: "João" },
});

// ── setup ──────────────────────────────────────────────────────────────────────

function buildMockDb() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "msg-uuid" }, error: null });
  const mockDbObj = {
    from: vi.fn((table: string) => {
      if (table === "messages") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: mockSingle }),
          }),
        };
      }
      throw new Error(`Unexpected db.from("${table}") — mock it explicitly`);
    }),
  };
  return mockDbObj;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockGetAdminClient.mockReturnValue(buildMockDb());

  // Passo 1: nenhum flow ativo → sem novos enrollments para simplificar
  mockGetActiveRemarketingFlows.mockResolvedValue([]);
  mockGetConversationsEligibleForEnrollment.mockResolvedValue([]);
  mockGetFirstActiveStep.mockResolvedValue(null);
  mockCreateEnrollment.mockResolvedValue({});

  // Passo 2: defaults
  mockGetActiveEnrollments.mockResolvedValue([]);
  mockGetRemarketingFlowsByIds.mockResolvedValue([]);
  mockGetRemarketingStepsByIds.mockResolvedValue([]);
  mockIsConversationResolved.mockResolvedValue(false);
  mockHasContactRepliedSince.mockResolvedValue(false);
  mockGetLastContactMessage.mockResolvedValue(null);
  mockIsOptOutMessage.mockReturnValue(false);
  mockGetConversationById.mockResolvedValue(makeConversation("conv-enr-1"));
  mockGetNextActiveStep.mockResolvedValue(null);
  mockAdvanceEnrollment.mockResolvedValue(undefined);
  mockUpdateFlowLastExecuted.mockResolvedValue(undefined);
  mockCancelEnrollment.mockResolvedValue(undefined);
  mockReturnConversationToAgent.mockResolvedValue(undefined);

  mockGetSendMessageQueue.mockReturnValue({ add: mockQueueAdd });
  mockGetRemarketingQueue.mockReturnValue({ upsertJobScheduler: vi.fn() });
  mockQueueAdd.mockResolvedValue(undefined);
});

// ── testes de eliminação N+1 ───────────────────────────────────────────────────

describe("processRemarketingCycle — eliminação N+1", () => {
  it("T1: getRemarketingStepsByIds é chamado exatamente 1 vez, independente do número de enrollments", async () => {
    const enr1 = makeEnrollment("enr-1", FLOW_1_ID, STEP_1_ID);
    const enr2 = makeEnrollment("enr-2", FLOW_2_ID, STEP_2_ID);
    mockGetActiveEnrollments.mockResolvedValue([enr1, enr2]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([makeFlow(FLOW_1_ID), makeFlow(FLOW_2_ID)]);
    mockGetRemarketingStepsByIds.mockResolvedValue([makeStep(STEP_1_ID, FLOW_1_ID), makeStep(STEP_2_ID, FLOW_2_ID)]);
    mockGetConversationById
      .mockResolvedValueOnce(makeConversation("conv-enr-1"))
      .mockResolvedValueOnce(makeConversation("conv-enr-2"));

    await processRemarketingCycle();

    expect(mockGetRemarketingStepsByIds).toHaveBeenCalledTimes(1);
  });

  it("T2: getRemarketingStepsByIds é chamado com todos os next_step_ids em batch", async () => {
    const enr1 = makeEnrollment("enr-1", FLOW_1_ID, STEP_1_ID);
    const enr2 = makeEnrollment("enr-2", FLOW_2_ID, STEP_2_ID);
    mockGetActiveEnrollments.mockResolvedValue([enr1, enr2]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([makeFlow(FLOW_1_ID), makeFlow(FLOW_2_ID)]);
    mockGetRemarketingStepsByIds.mockResolvedValue([makeStep(STEP_1_ID, FLOW_1_ID), makeStep(STEP_2_ID, FLOW_2_ID)]);
    mockGetConversationById
      .mockResolvedValueOnce(makeConversation("conv-enr-1"))
      .mockResolvedValueOnce(makeConversation("conv-enr-2"));

    await processRemarketingCycle();

    expect(mockGetRemarketingStepsByIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([STEP_1_ID, STEP_2_ID])
    );
  });

  it("T3: getRemarketingFlowsByIds é chamado exatamente 1 vez para todos os enrollments", async () => {
    const enr1 = makeEnrollment("enr-1", FLOW_1_ID, STEP_1_ID);
    const enr2 = makeEnrollment("enr-2", FLOW_2_ID, STEP_2_ID);
    mockGetActiveEnrollments.mockResolvedValue([enr1, enr2]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([makeFlow(FLOW_1_ID), makeFlow(FLOW_2_ID)]);
    mockGetRemarketingStepsByIds.mockResolvedValue([makeStep(STEP_1_ID, FLOW_1_ID), makeStep(STEP_2_ID, FLOW_2_ID)]);
    mockGetConversationById
      .mockResolvedValueOnce(makeConversation("conv-enr-1"))
      .mockResolvedValueOnce(makeConversation("conv-enr-2"));

    await processRemarketingCycle();

    expect(mockGetRemarketingFlowsByIds).toHaveBeenCalledTimes(1);
  });

  it("T4: getStepById nunca é chamado durante o processamento", async () => {
    const enr1 = makeEnrollment("enr-1", FLOW_1_ID, STEP_1_ID);
    const enr2 = makeEnrollment("enr-2", FLOW_2_ID, STEP_2_ID);
    mockGetActiveEnrollments.mockResolvedValue([enr1, enr2]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([makeFlow(FLOW_1_ID), makeFlow(FLOW_2_ID)]);
    mockGetRemarketingStepsByIds.mockResolvedValue([makeStep(STEP_1_ID, FLOW_1_ID), makeStep(STEP_2_ID, FLOW_2_ID)]);
    mockGetConversationById
      .mockResolvedValueOnce(makeConversation("conv-enr-1"))
      .mockResolvedValueOnce(makeConversation("conv-enr-2"));

    await processRemarketingCycle();

    expect(mockGetStepById).not.toHaveBeenCalled();
  });

  it("T5: updateFlowLastExecuted é chamado 1 vez por flow distinto, não por enrollment", async () => {
    // 3 enrollments: 2 do FLOW_1, 1 do FLOW_2
    const enr1 = makeEnrollment("enr-1", FLOW_1_ID, STEP_1_ID);
    const enr2 = makeEnrollment("enr-2", FLOW_1_ID, STEP_2_ID);
    const enr3 = makeEnrollment("enr-3", FLOW_2_ID, STEP_3_ID);
    mockGetActiveEnrollments.mockResolvedValue([enr1, enr2, enr3]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([makeFlow(FLOW_1_ID), makeFlow(FLOW_2_ID)]);
    mockGetRemarketingStepsByIds.mockResolvedValue([
      makeStep(STEP_1_ID, FLOW_1_ID),
      makeStep(STEP_2_ID, FLOW_1_ID),
      makeStep(STEP_3_ID, FLOW_2_ID),
    ]);
    mockGetConversationById
      .mockResolvedValueOnce(makeConversation("conv-enr-1"))
      .mockResolvedValueOnce(makeConversation("conv-enr-2"))
      .mockResolvedValueOnce(makeConversation("conv-enr-3"));

    await processRemarketingCycle();

    // Deve ser chamado exatamente 2 vezes (FLOW_1 e FLOW_2), não 3
    expect(mockUpdateFlowLastExecuted).toHaveBeenCalledTimes(2);
    expect(mockUpdateFlowLastExecuted).toHaveBeenCalledWith(expect.anything(), FLOW_1_ID, expect.any(String));
    expect(mockUpdateFlowLastExecuted).toHaveBeenCalledWith(expect.anything(), FLOW_2_ID, expect.any(String));
  });

  it("T6: sem enrollments ativos → nenhuma query de batch é feita", async () => {
    mockGetActiveEnrollments.mockResolvedValue([]);

    await processRemarketingCycle();

    expect(mockGetRemarketingFlowsByIds).not.toHaveBeenCalled();
    expect(mockGetRemarketingStepsByIds).not.toHaveBeenCalled();
    expect(mockUpdateFlowLastExecuted).not.toHaveBeenCalled();
  });

  it("T7: enrollment cujo timer não chegou → não processa e não chama updateFlowLastExecuted", async () => {
    const futureEnrollment = {
      ...makeEnrollment("enr-future", FLOW_1_ID, STEP_1_ID),
      last_step_sent_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h no futuro
    };
    mockGetActiveEnrollments.mockResolvedValue([futureEnrollment]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([makeFlow(FLOW_1_ID)]);
    mockGetRemarketingStepsByIds.mockResolvedValue([makeStep(STEP_1_ID, FLOW_1_ID)]);

    await processRemarketingCycle();

    expect(mockUpdateFlowLastExecuted).not.toHaveBeenCalled();
  });

  it("T8: conversa resolvida → cancela enrollment sem chamar updateFlowLastExecuted", async () => {
    const enr = makeEnrollment("enr-resolved", FLOW_1_ID, STEP_1_ID);
    mockGetActiveEnrollments.mockResolvedValue([enr]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([makeFlow(FLOW_1_ID)]);
    mockGetRemarketingStepsByIds.mockResolvedValue([makeStep(STEP_1_ID, FLOW_1_ID)]);
    mockIsConversationResolved.mockResolvedValue(true);

    await processRemarketingCycle();

    expect(mockCancelEnrollment).toHaveBeenCalledWith(expect.anything(), "enr-resolved", "resolved", "org-1");
    expect(mockUpdateFlowLastExecuted).not.toHaveBeenCalled();
  });
});
