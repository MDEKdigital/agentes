/**
 * RED tests for SE-1 (vault cache TTL), EI-1 (media validation),
 * and EI-2 (remarketing minimum delay).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── SE-1: vault cache TTL ─────────────────────────────────────────────────────

const { mockGetAdminClient, mockMaybySingle } = vi.hoisted(() => {
  const mockMaybySingle = vi.fn();
  const mockGetAdminClient = vi.fn();
  return { mockGetAdminClient, mockMaybySingle };
});

const { mockDecrypt } = vi.hoisted(() => ({
  mockDecrypt: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
}));

vi.mock("../lib/crypto", () => ({
  decrypt: mockDecrypt,
}));

import { resolveApiKey, CACHE_TTL_MS, __testClearCache } from "../lib/vault";
import { validateMediaPayload, MAX_MEDIA_BASE64_CHARS } from "../lib/media-validation";

function buildVaultDb() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mockMaybySingle,
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe("SE-1: vault — TTL do cache de API keys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __testClearCache();
    mockDecrypt.mockReturnValue("sk-live-decrypted");
    mockMaybySingle.mockResolvedValue({ data: { encrypted_key: "enc-abc" }, error: null });
    mockGetAdminClient.mockReturnValue(buildVaultDb());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("CACHE_TTL_MS é no máximo 60 segundos", () => {
    expect(CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it("segunda chamada retorna do cache sem consultar DB novamente", async () => {
    await resolveApiKey("org-1", "openai");
    await resolveApiKey("org-1", "openai");
    expect(mockMaybySingle).toHaveBeenCalledTimes(1);
  });

  it("cache expira após TTL e DB é consultado novamente", async () => {
    await resolveApiKey("org-1", "openai");
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    await resolveApiKey("org-1", "openai");
    expect(mockMaybySingle).toHaveBeenCalledTimes(2);
  });

  it("chave retornada é válida após re-consulta pós-TTL", async () => {
    await resolveApiKey("org-1", "openai");
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    const key = await resolveApiKey("org-1", "openai");
    expect(key).toBe("sk-live-decrypted");
  });

  it("TTL anterior a 5 minutos (não guarda por mais de 5min)", () => {
    expect(CACHE_TTL_MS).toBeLessThan(5 * 60 * 1000);
  });
});

// ── EI-1: media validation ─────────────────────────────────────────────────────

describe("EI-1: validateMediaPayload — allowlist de mimeType e limite de tamanho", () => {
  it("mimeType não permitido lança erro genérico", () => {
    expect(() => validateMediaPayload("dGVzdA==", "application/pdf")).toThrow(
      /media validation failed/i
    );
  });

  it("mimeType 'text/html' (injeção via mimetype) é rejeitado", () => {
    expect(() => validateMediaPayload("dGVzdA==", "text/html")).toThrow();
  });

  it("mimeType 'application/octet-stream' é rejeitado", () => {
    expect(() => validateMediaPayload("dGVzdA==", "application/octet-stream")).toThrow();
  });

  it("mimeType de áudio válido é aceito", () => {
    expect(() => validateMediaPayload("dGVzdA==", "audio/ogg")).not.toThrow();
  });

  it("mimeType de áudio com codec suffix é aceito (split por ;)", () => {
    expect(() => validateMediaPayload("dGVzdA==", "audio/ogg; codecs=opus")).not.toThrow();
  });

  it("mimeType de imagem válido é aceito", () => {
    expect(() => validateMediaPayload("aW1hZ2U=", "image/jpeg")).not.toThrow();
  });

  it("base64 que excede MAX_MEDIA_BASE64_CHARS é rejeitado", () => {
    const oversized = "a".repeat(MAX_MEDIA_BASE64_CHARS + 1);
    expect(() => validateMediaPayload(oversized, "audio/ogg")).toThrow(
      /media validation failed/i
    );
  });

  it("base64 com exatamente MAX_MEDIA_BASE64_CHARS é aceito", () => {
    const exact = "a".repeat(MAX_MEDIA_BASE64_CHARS);
    expect(() => validateMediaPayload(exact, "audio/ogg")).not.toThrow();
  });

  it("mensagem de erro não vaza mimeType ou tamanho real (genérica)", () => {
    try {
      validateMediaPayload("x", "application/pdf");
      expect.fail("deveria ter lançado");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("application/pdf");
    }
  });
});

// ── EI-2: remarketing minimum delay ──────────────────────────────────────────

const {
  mockGetActiveRemarketingFlows,
  mockGetActiveEnrollments,
  mockGetRemarketingFlowsByIds,
  mockGetRemarketingStepsByIds,
  mockIsConversationResolved,
  mockHasContactRepliedSince,
  mockGetLastContactMessage,
  mockIsOptOutMessage,
  mockGetConversationById,
  mockGetNextActiveStep,
  mockAdvanceEnrollment,
  mockUpdateFlowLastExecuted,
  mockCancelEnrollment,
  mockReturnConversationToAgent,
  mockQueueAdd,
  mockGetSendMessageQueue,
  mockGetRemarketingQueue,
  mockAcquireEnrollmentLock,
  mockReleaseEnrollmentLock,
  mockCreateAuditLog,
  mockGetAdminClientRmkt,
} = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
  return {
    mockGetActiveRemarketingFlows: vi.fn(),
    mockGetActiveEnrollments: vi.fn(),
    mockGetRemarketingFlowsByIds: vi.fn(),
    mockGetRemarketingStepsByIds: vi.fn(),
    mockIsConversationResolved: vi.fn(),
    mockHasContactRepliedSince: vi.fn(),
    mockGetLastContactMessage: vi.fn(),
    mockIsOptOutMessage: vi.fn(),
    mockGetConversationById: vi.fn(),
    mockGetNextActiveStep: vi.fn(),
    mockAdvanceEnrollment: vi.fn(),
    mockUpdateFlowLastExecuted: vi.fn(),
    mockCancelEnrollment: vi.fn(),
    mockReturnConversationToAgent: vi.fn(),
    mockQueueAdd,
    mockGetSendMessageQueue: vi.fn().mockReturnValue({ add: mockQueueAdd }),
    mockGetRemarketingQueue: vi.fn().mockReturnValue({
      upsertJobScheduler: vi.fn(),
    }),
    mockAcquireEnrollmentLock: vi.fn().mockResolvedValue("lock-token"),
    mockReleaseEnrollmentLock: vi.fn().mockResolvedValue(undefined),
    mockCreateAuditLog: vi.fn(),
    mockGetAdminClientRmkt: vi.fn(),
  };
});

// Note: @aula-agente/database already mocked above for SE-1.
// We extend it here by including all remarketing functions:
vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: mockGetSendMessageQueue,
  getRemarketingQueue: mockGetRemarketingQueue,
}));
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));
vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn().mockReturnValue({}) }));
vi.mock("../lib/lock", () => ({
  acquireEnrollmentLock: mockAcquireEnrollmentLock,
  releaseEnrollmentLock: mockReleaseEnrollmentLock,
}));
vi.mock("../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_MESSAGE: "process-message", REMARKETING: "remarketing" },
}));

// Re-mock @aula-agente/database to include remarketing functions
vi.mock("@aula-agente/database", () => ({
  getAdminClient: (...args: unknown[]) => {
    // Return remarketing DB when called from remarketing context (has from.messages)
    return mockGetAdminClientRmkt(...args) ?? mockGetAdminClient();
  },
  getActiveRemarketingFlows: mockGetActiveRemarketingFlows,
  getConversationsEligibleForEnrollment: vi.fn().mockResolvedValue([]),
  getFirstActiveStep: vi.fn().mockResolvedValue(null),
  createEnrollment: vi.fn(),
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

import { processRemarketingCycle, MINIMUM_DELAY_MINUTES } from "../workers/remarketing-worker";

const PAST = "2020-01-01T00:00:00.000Z";

function makeFlow(id: string) {
  return {
    id,
    organization_id: "org-1",
    agent_id: "agent-1",
    instance_id: "inst-1",
    status: "active",
    cancel_on_reply: false,
    cancel_on_resolved: true,
    cancel_on_opt_out: false,
    entry_silence_minutes: 15,
  };
}

function makeStep(id: string, flowId: string, delayValue: number, delayUnit: string) {
  return {
    id,
    flow_id: flowId,
    step_order: 1,
    delay_value: delayValue,
    delay_unit: delayUnit,
    message_type: "text",
    message_content: "Olá!",
    is_active: true,
  };
}

function makeEnrollment(id: string, flowId: string, stepId: string) {
  return {
    id,
    flow_id: flowId,
    conversation_id: `conv-${id}`,
    organization_id: "org-1",
    next_step_id: stepId,
    enrolled_at: PAST,
    last_step_sent_at: null,
    status: "active",
  };
}

function buildRmktDb() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "msg-uuid" }, error: null });
  return {
    from: vi.fn((table: string) => {
      if (table === "messages") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: mockSingle }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({}),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("EI-2: remarketing — delay mínimo por enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAdminClientRmkt.mockReturnValue(buildRmktDb());
    mockGetActiveRemarketingFlows.mockResolvedValue([]);
    mockGetActiveEnrollments.mockResolvedValue([]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([]);
    mockGetRemarketingStepsByIds.mockResolvedValue([]);
    mockIsConversationResolved.mockResolvedValue(false);
    mockHasContactRepliedSince.mockResolvedValue(false);
    mockGetLastContactMessage.mockResolvedValue(null);
    mockIsOptOutMessage.mockReturnValue(false);
    mockGetConversationById.mockResolvedValue({
      id: "conv-enr-1",
      organization_id: "org-1",
      evolution_instance_id: "inst-1",
      contacts: { phone: "5511999999999" },
    });
    mockGetNextActiveStep.mockResolvedValue(null);
    mockAdvanceEnrollment.mockResolvedValue(undefined);
    mockUpdateFlowLastExecuted.mockResolvedValue(undefined);
    mockCancelEnrollment.mockResolvedValue(undefined);
    mockReturnConversationToAgent.mockResolvedValue(undefined);
    mockAcquireEnrollmentLock.mockResolvedValue("lock-token");
    mockReleaseEnrollmentLock.mockResolvedValue(undefined);
    mockGetSendMessageQueue.mockReturnValue({ add: mockQueueAdd });
  });

  it("MINIMUM_DELAY_MINUTES está exportado e é pelo menos 1 minuto", () => {
    expect(MINIMUM_DELAY_MINUTES).toBeGreaterThanOrEqual(1);
  });

  it("step com delay_value=0 não resulta em envio (bloqueado pelo rate limit)", async () => {
    const flow = makeFlow("flow-1");
    const step = makeStep("step-1", "flow-1", 0, "minutes");
    const enrollment = makeEnrollment("enr-1", "flow-1", "step-1");

    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([flow]);
    mockGetRemarketingStepsByIds.mockResolvedValue([step]);

    await processRemarketingCycle();

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("step com delay_value abaixo do mínimo não avança o enrollment", async () => {
    const belowMin = MINIMUM_DELAY_MINUTES - 1;
    if (belowMin < 0) return; // skip if minimum is 0 (shouldn't happen)

    const flow = makeFlow("flow-1");
    const step = makeStep("step-1", "flow-1", belowMin, "minutes");
    const enrollment = makeEnrollment("enr-1", "flow-1", "step-1");

    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([flow]);
    mockGetRemarketingStepsByIds.mockResolvedValue([step]);

    await processRemarketingCycle();

    expect(mockAdvanceEnrollment).not.toHaveBeenCalled();
  });

  it("step com delay válido (>= mínimo) resulta em envio normalmente", async () => {
    const safeDelay = MINIMUM_DELAY_MINUTES * 2;
    const flow = makeFlow("flow-1");
    const step = makeStep("step-1", "flow-1", safeDelay, "minutes");
    const enrollment = makeEnrollment("enr-1", "flow-1", "step-1");

    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([flow]);
    mockGetRemarketingStepsByIds.mockResolvedValue([step]);

    await processRemarketingCycle();

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("step com 1 hora de delay é processado normalmente", async () => {
    const flow = makeFlow("flow-1");
    const step = makeStep("step-1", "flow-1", 1, "hours");
    const enrollment = makeEnrollment("enr-1", "flow-1", "step-1");

    mockGetActiveEnrollments.mockResolvedValue([enrollment]);
    mockGetRemarketingFlowsByIds.mockResolvedValue([flow]);
    mockGetRemarketingStepsByIds.mockResolvedValue([step]);

    await processRemarketingCycle();

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });
});
