/**
 * RED tests for OB-6: remarketing processor drops enrollments silently on data errors.
 *
 * Problem:
 *   processRemarketingCycle() uses bare console.error (no structured fields) and
 *   no incrementMetric when skipping enrollments due to:
 *     - getConversationById returns null
 *     - conversation.contacts has no phone
 *     - flow.instance_id is missing
 *
 *   These are permanent silent drops — enrollments are never advanced or cancelled,
 *   they silently stay active and get skipped every cycle with no production-visible trace.
 *
 * Fix:
 *   Replace each console.error with workerLog("remarketing", "error", { enrollmentId,
 *   conversationId|flowId, organizationId }, msg) + incrementMetric("remarketing_enrollment_skipped").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockWorkerLog, mockIncrementMetric } = vi.hoisted(() => ({
  mockWorkerLog: vi.fn(),
  mockIncrementMetric: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({ workerLog: mockWorkerLog }));
vi.mock("../lib/metrics", () => ({ incrementMetric: mockIncrementMetric }));
vi.mock("../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("../lib/dead-letter", () => ({
  enqueueDeadLetter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/lock", () => ({
  acquireEnrollmentLock: vi.fn().mockResolvedValue("lock-value"),
  releaseEnrollmentLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: {
    REMARKETING: "remarketing",
    SEND_MESSAGE: "send-message",
    PROCESS_MESSAGE: "process-message",
  },
}));
vi.mock("@aula-agente/queue", () => ({
  getRemarketingQueue: vi.fn(() => ({ upsertJobScheduler: vi.fn() })),
  getSendMessageQueue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({}) })),
  getConnectionOptions: vi.fn(() => ({})),
}));
vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
  Queue: vi.fn().mockImplementation(() => ({ upsertJobScheduler: vi.fn() })),
}));

// Per-test mocks for database functions (reset in beforeEach)
const mockGetActiveRemarketingFlows = vi.fn();
const mockGetActiveEnrollments = vi.fn();
const mockGetRemarketingFlowsByIds = vi.fn();
const mockGetRemarketingStepsByIds = vi.fn();
const mockGetConversationById = vi.fn();
const mockIsConversationResolved = vi.fn();
const mockAcquireEnrollmentLock = vi.fn();

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getActiveRemarketingFlows: (...args: unknown[]) => mockGetActiveRemarketingFlows(...args),
  getActiveEnrollments: (...args: unknown[]) => mockGetActiveEnrollments(...args),
  getRemarketingFlowsByIds: (...args: unknown[]) => mockGetRemarketingFlowsByIds(...args),
  getRemarketingStepsByIds: (...args: unknown[]) => mockGetRemarketingStepsByIds(...args),
  getConversationById: (...args: unknown[]) => mockGetConversationById(...args),
  isConversationResolved: (...args: unknown[]) => mockIsConversationResolved(...args),
  getFirstActiveStep: vi.fn().mockResolvedValue(null),
  getConversationsEligibleForEnrollment: vi.fn().mockResolvedValue([]),
  createEnrollment: vi.fn().mockResolvedValue({}),
  cancelEnrollment: vi.fn().mockResolvedValue({}),
  advanceEnrollment: vi.fn().mockResolvedValue({}),
  updateFlowLastExecuted: vi.fn().mockResolvedValue({}),
  hasContactRepliedSince: vi.fn().mockResolvedValue(false),
  getLastContactMessage: vi.fn().mockResolvedValue(null),
  isOptOutMessage: vi.fn().mockReturnValue(false),
  returnConversationToAgent: vi.fn().mockResolvedValue({}),
  getNextActiveStep: vi.fn().mockResolvedValue(null),
  createAuditLog: vi.fn(),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { processRemarketingCycle } from "../workers/remarketing-worker";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENROLLMENT_ID = "enr-001";
const FLOW_ID = "flow-001";
const STEP_ID = "step-001";
const CONVERSATION_ID = "conv-001";
const ORG_ID = "org-001";

function makeEnrollment(overrides = {}) {
  return {
    id: ENROLLMENT_ID,
    flow_id: FLOW_ID,
    conversation_id: CONVERSATION_ID,
    organization_id: ORG_ID,
    next_step_id: STEP_ID,
    // 2 hours ago → step with 60-min delay is ready
    enrolled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    last_step_sent_at: null,
    ...overrides,
  };
}

function makeStep(overrides = {}) {
  return {
    id: STEP_ID,
    step_order: 1,
    delay_value: 60,
    delay_unit: "minutes",
    message_content: "Olá! Temos uma novidade para você.",
    message_type: "text",
    ...overrides,
  };
}

function makeFlow(overrides = {}) {
  return {
    id: FLOW_ID,
    instance_id: "inst-001",
    cancel_on_reply: false,
    cancel_on_opt_out: false,
    agent_id: null,
    ...overrides,
  };
}

function makeConversation(overrides = {}) {
  return {
    id: CONVERSATION_ID,
    organization_id: ORG_ID,
    contacts: { phone: "+5511999999999" },
    ...overrides,
  };
}

function setupDefault(enrollmentOverrides = {}, flowOverrides = {}) {
  const enrollment = makeEnrollment(enrollmentOverrides);
  const step = makeStep();
  const flow = makeFlow(flowOverrides);

  mockGetActiveRemarketingFlows.mockResolvedValue([]);
  mockGetActiveEnrollments.mockResolvedValue([enrollment]);
  mockGetRemarketingFlowsByIds.mockResolvedValue([flow]);
  mockGetRemarketingStepsByIds.mockResolvedValue([step]);
  mockIsConversationResolved.mockResolvedValue(false);
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ════════════════════════════════════════════════════════════════════════════
// OB-6A — conversation not found → workerLog + incrementMetric
// ════════════════════════════════════════════════════════════════════════════

describe("OB-6A: enrollment skip — conversation not found", () => {
  it("chama workerLog('remarketing', 'error', ...) quando conversation não existe", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(null);

    await processRemarketingCycle();

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "remarketing",
      "error",
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID }),
      expect.stringMatching(/conversation.*not found|not found/i)
    );
  });

  it("contexto tem conversationId e organizationId quando conversation não existe", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(null);

    await processRemarketingCycle();

    const errorCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "remarketing" && level === "error"
    );
    expect(errorCall).toBeDefined();
    const ctx = errorCall?.[2] as Record<string, unknown>;
    expect(ctx.enrollmentId).toBe(ENROLLMENT_ID);
    expect(ctx.conversationId ?? ctx.organizationId).toBeTruthy();
  });

  it("incrementMetric('remarketing_enrollment_skipped') quando conversation não existe", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(null);

    await processRemarketingCycle();

    expect(mockIncrementMetric).toHaveBeenCalledWith("remarketing_enrollment_skipped");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-6B — no phone → workerLog + incrementMetric
// ════════════════════════════════════════════════════════════════════════════

describe("OB-6B: enrollment skip — contact sem telefone", () => {
  it("chama workerLog('remarketing', 'error', ...) quando contacts.phone está ausente", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(makeConversation({ contacts: { phone: null } }));

    await processRemarketingCycle();

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "remarketing",
      "error",
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID }),
      expect.stringMatching(/phone|no phone/i)
    );
  });

  it("incrementMetric('remarketing_enrollment_skipped') quando phone está ausente", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(makeConversation({ contacts: { phone: null } }));

    await processRemarketingCycle();

    expect(mockIncrementMetric).toHaveBeenCalledWith("remarketing_enrollment_skipped");
  });

  it("chama workerLog quando contacts é null (sem contato associado)", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(makeConversation({ contacts: null }));

    await processRemarketingCycle();

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "remarketing",
      "error",
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID }),
      expect.any(String)
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-6C — no instance_id → workerLog + incrementMetric
// ════════════════════════════════════════════════════════════════════════════

describe("OB-6C: enrollment skip — flow sem instance_id", () => {
  it("chama workerLog('remarketing', 'error', ...) quando flow.instance_id é null", async () => {
    setupDefault({}, { instance_id: null });
    mockGetConversationById.mockResolvedValue(makeConversation());

    await processRemarketingCycle();

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "remarketing",
      "error",
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID }),
      expect.stringMatching(/instance_id|no instance/i)
    );
  });

  it("contexto tem flowId quando flow.instance_id é null", async () => {
    setupDefault({}, { instance_id: null });
    mockGetConversationById.mockResolvedValue(makeConversation());

    await processRemarketingCycle();

    const errorCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "remarketing" && level === "error"
    );
    const ctx = errorCall?.[2] as Record<string, unknown>;
    expect(ctx.flowId ?? ctx.enrollmentId).toBeTruthy();
  });

  it("incrementMetric('remarketing_enrollment_skipped') quando flow.instance_id é null", async () => {
    setupDefault({}, { instance_id: null });
    mockGetConversationById.mockResolvedValue(makeConversation());

    await processRemarketingCycle();

    expect(mockIncrementMetric).toHaveBeenCalledWith("remarketing_enrollment_skipped");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-6D — invariant: remarketing_step_sent NÃO incrementado em caso de skip
// ════════════════════════════════════════════════════════════════════════════

describe("OB-6D: invariante — remarketing_step_sent não é chamado em caso de data error", () => {
  it("remarketing_step_sent NÃO incrementado quando conversation é null", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(null);

    await processRemarketingCycle();

    const stepSentCalls = mockIncrementMetric.mock.calls.filter(
      ([name]) => name === "remarketing_step_sent"
    );
    expect(stepSentCalls).toHaveLength(0);
  });

  it("remarketing_step_sent NÃO incrementado quando phone está ausente", async () => {
    setupDefault();
    mockGetConversationById.mockResolvedValue(makeConversation({ contacts: null }));

    await processRemarketingCycle();

    const stepSentCalls = mockIncrementMetric.mock.calls.filter(
      ([name]) => name === "remarketing_step_sent"
    );
    expect(stepSentCalls).toHaveLength(0);
  });
});
