import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetAdminClient,
  mockGetActiveRemarketingFlows,
  mockGetConversationsEligibleForEnrollment,
  mockGetFirstActiveStep,
  mockCreateEnrollment,
  mockGetActiveEnrollments,
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
  mockCreateAuditLog,
  mockAcquireEnrollmentLock,
  mockReleaseEnrollmentLock,
} = vi.hoisted(() => ({
  mockGetAdminClient: vi.fn(),
  mockGetActiveRemarketingFlows: vi.fn().mockResolvedValue([]),
  mockGetConversationsEligibleForEnrollment: vi.fn().mockResolvedValue([]),
  mockGetFirstActiveStep: vi.fn(),
  mockCreateEnrollment: vi.fn(),
  mockGetActiveEnrollments: vi.fn(),
  mockGetRemarketingFlowsByIds: vi.fn().mockResolvedValue([]),
  mockGetRemarketingStepsByIds: vi.fn().mockResolvedValue([]),
  mockCancelEnrollment: vi.fn().mockResolvedValue({}),
  mockAdvanceEnrollment: vi.fn().mockResolvedValue({}),
  mockUpdateFlowLastExecuted: vi.fn().mockResolvedValue({}),
  mockIsConversationResolved: vi.fn().mockResolvedValue(false),
  mockHasContactRepliedSince: vi.fn().mockResolvedValue(false),
  mockGetLastContactMessage: vi.fn().mockResolvedValue(null),
  mockIsOptOutMessage: vi.fn().mockReturnValue(false),
  mockGetConversationById: vi.fn(),
  mockGetNextActiveStep: vi.fn().mockResolvedValue(null),
  mockReturnConversationToAgent: vi.fn().mockResolvedValue({}),
  mockQueueAdd: vi.fn().mockResolvedValue({}),
  mockGetSendMessageQueue: vi.fn(),
  mockGetRemarketingQueue: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockAcquireEnrollmentLock: vi.fn(),
  mockReleaseEnrollmentLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getActiveRemarketingFlows: mockGetActiveRemarketingFlows,
  getConversationsEligibleForEnrollment: mockGetConversationsEligibleForEnrollment,
  getFirstActiveStep: mockGetFirstActiveStep,
  createEnrollment: mockCreateEnrollment,
  getActiveEnrollments: mockGetActiveEnrollments,
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
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: mockGetSendMessageQueue,
  getRemarketingQueue: mockGetRemarketingQueue,
}));

vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn().mockReturnValue({}) }));

vi.mock("../../lib/lock", () => ({
  acquireEnrollmentLock: mockAcquireEnrollmentLock,
  releaseEnrollmentLock: mockReleaseEnrollmentLock,
  // keep existing conversation lock exports intact
  acquireConversationLock: vi.fn().mockResolvedValue("lock-value"),
  releaseConversationLock: vi.fn().mockResolvedValue(undefined),
}));

import { processRemarketingCycle } from "../remarketing-worker";

// ── fixtures ───────────────────────────────────────────────────────────────────

const PAST = "2020-01-01T00:00:00.000Z";
const FLOW_ID = "flow-uuid-c16";
const STEP_ID = "step-uuid-c16";
const ENROLLMENT_ID = "enroll-uuid-c16";
const CONV_ID = "conv-uuid-c16";
const ORG_ID = "org-uuid-c16";

const flow = {
  id: FLOW_ID,
  organization_id: ORG_ID,
  agent_id: "agent-1",
  instance_id: "inst-1",
  status: "active",
  cancel_on_reply: false,
  cancel_on_resolved: false,
  cancel_on_opt_out: false,
  entry_silence_minutes: 15,
};

const step = {
  id: STEP_ID,
  flow_id: FLOW_ID,
  step_order: 1,
  delay_value: 1,
  delay_unit: "minutes",
  message_type: "text",
  message_content: "Olá!",
  is_active: true,
};

const enrollment = {
  id: ENROLLMENT_ID,
  flow_id: FLOW_ID,
  conversation_id: CONV_ID,
  organization_id: ORG_ID,
  next_step_id: STEP_ID,
  enrolled_at: PAST,
  last_step_sent_at: null,
  status: "active",
};

const conversation = {
  id: CONV_ID,
  organization_id: ORG_ID,
  contacts: { phone: "+5511999999999" },
};

function makeInsertChain(messageId: string) {
  const single = vi.fn().mockResolvedValue({
    data: { id: messageId },
    error: null,
  });
  const select = vi.fn().mockReturnValue({ single });
  const insertFn = vi.fn().mockReturnValue({ select });
  const deleteFn = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return { insert: insertFn, delete: deleteFn };
}

function makeDb(msgChain: ReturnType<typeof makeInsertChain>) {
  return {
    from: vi.fn((_table: string) => msgChain),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveRemarketingFlows.mockResolvedValue([]);
  mockGetConversationsEligibleForEnrollment.mockResolvedValue([]);
  mockGetRemarketingFlowsByIds.mockResolvedValue([flow]);
  mockGetRemarketingStepsByIds.mockResolvedValue([step]);
  mockIsConversationResolved.mockResolvedValue(false);
  mockHasContactRepliedSince.mockResolvedValue(false);
  mockGetLastContactMessage.mockResolvedValue(null);
  mockIsOptOutMessage.mockReturnValue(false);
  mockGetConversationById.mockResolvedValue(conversation);
  mockGetNextActiveStep.mockResolvedValue(null);
  mockAdvanceEnrollment.mockResolvedValue({});
  mockCreateAuditLog.mockResolvedValue({});
  mockReleaseEnrollmentLock.mockResolvedValue(undefined);
  mockGetSendMessageQueue.mockReturnValue({ add: mockQueueAdd });
  mockGetRemarketingQueue.mockReturnValue({
    upsertJobScheduler: vi.fn(),
  });
  mockQueueAdd.mockResolvedValue({});
});

// ─── C16 tests ────────────────────────────────────────────────────────────────

describe("C16: remarketing enrollment distributed lock for horizontal scale", () => {
  it("C16: worker que adquire o lock processa o enrollment normalmente", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue("lock-token-abc");

    await processRemarketingCycle();

    expect(mockAcquireEnrollmentLock).toHaveBeenCalledWith(ENROLLMENT_ID);
    expect(msgChain.insert).toHaveBeenCalled();
  });

  it("C16: worker que adquire o lock enfileira envio WhatsApp", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue("lock-token-abc");

    await processRemarketingCycle();

    expect(mockQueueAdd).toHaveBeenCalled();
  });

  it("C16: worker que adquire o lock avança enrollment", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue("lock-token-abc");

    await processRemarketingCycle();

    expect(mockAdvanceEnrollment).toHaveBeenCalledWith(
      expect.anything(),
      ENROLLMENT_ID,
      null,
      ORG_ID
    );
  });

  it("C16: worker que adquire o lock dispara audit step_sent", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue("lock-token-abc");

    await processRemarketingCycle();

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "remarketing.step_sent", entity_id: ENROLLMENT_ID })
    );
  });

  it("C16: worker que NÃO adquire o lock NÃO insere mensagem", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue(null); // lock held by another worker

    await processRemarketingCycle();

    expect(msgChain.insert).not.toHaveBeenCalled();
  });

  it("C16: worker que NÃO adquire o lock NÃO enfileira envio", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue(null);

    await processRemarketingCycle();

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("C16: worker que NÃO adquire o lock NÃO avança enrollment", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue(null);

    await processRemarketingCycle();

    expect(mockAdvanceEnrollment).not.toHaveBeenCalled();
  });

  it("C16: worker que NÃO adquire o lock NÃO audita step_sent", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue(null);

    await processRemarketingCycle();

    const stepSentCalls = mockCreateAuditLog.mock.calls.filter(
      (args) => (args[1] as { action: string })?.action === "remarketing.step_sent"
    );
    expect(stepSentCalls).toHaveLength(0);
  });

  it("C16: dois 'workers' competindo pelo mesmo enrollment — apenas um processa", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);

    // Simulate: first worker gets lock, second doesn't
    mockAcquireEnrollmentLock
      .mockResolvedValueOnce("lock-w1") // worker 1 acquires
      .mockResolvedValueOnce(null);      // worker 2 fails

    // Run two "workers" concurrently
    await Promise.all([processRemarketingCycle(), processRemarketingCycle()]);

    // Only one insert and one advance should have happened
    expect(msgChain.insert).toHaveBeenCalledTimes(1);
    expect(mockAdvanceEnrollment).toHaveBeenCalledTimes(1);
  });

  it("C16: lock é liberado após processamento bem-sucedido", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue("lock-tok");

    await processRemarketingCycle();

    expect(mockReleaseEnrollmentLock).toHaveBeenCalledWith(ENROLLMENT_ID, "lock-tok");
  });

  it("C16: lock é liberado mesmo se o processamento lançar erro", async () => {
    const msgChain = makeInsertChain("msg-1");
    mockGetAdminClient.mockReturnValue(makeDb(msgChain));
    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockAcquireEnrollmentLock.mockResolvedValue("lock-tok");
    // Simulate error mid-processing
    mockIsConversationResolved.mockRejectedValue(new Error("db error"));

    await processRemarketingCycle(); // should not throw (caught per-enrollment)

    expect(mockReleaseEnrollmentLock).toHaveBeenCalledWith(ENROLLMENT_ID, "lock-tok");
  });
});
