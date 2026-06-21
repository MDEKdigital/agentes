/**
 * RED tests for OB-1 (correlation context) and OB-2 (structured logs):
 * - workerLog utility format contract
 * - processTakeoverTimeouts emits structured fields
 * - send-message failed handler emits structured fields
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ════════════════════════════════════════════════════════════════════════════
// OB-1 / OB-2 — workerLog utility unit tests
// (RED: lib/logger.ts does not exist)
// ════════════════════════════════════════════════════════════════════════════

import { workerLog } from "../lib/logger";

describe("OB-1/OB-2: workerLog — formato de log estruturado", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefixo é [worker-name] no início da linha", () => {
    workerLog("process-message", "info", {}, "started");
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[process-message\]/);
  });

  it("campos chave=valor aparecem no formato correto", () => {
    workerLog("process-message", "info", { conversationId: "conv-1", messageId: "msg-1" }, "started");
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("conversationId=conv-1");
    expect(line).toContain("messageId=msg-1");
  });

  it("campos undefined são omitidos (não aparecem como 'undefined')", () => {
    workerLog("send-message", "info", { conversationId: undefined, messageId: "msg-1" }, "sent");
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).not.toContain("undefined");
    expect(line).toContain("messageId=msg-1");
  });

  it("level info → chama console.log (não console.error)", () => {
    workerLog("process-message", "info", {}, "started");
    expect(logSpy).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("level error → chama console.error (não console.log)", () => {
    workerLog("process-message", "error", { jobId: "j-1" }, "failed");
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("level warn → chama console.warn (não console.error nem console.log)", () => {
    workerLog("billing-onboarding", "warn", { billingEventId: "be-1" }, "already processed");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("mensagem aparece após os campos na string de saída", () => {
    workerLog("send-message", "info", { instanceId: "inst-1" }, "sent");
    const line = logSpy.mock.calls[0][0] as string;
    const instancePos = line.indexOf("instanceId=inst-1");
    const msgPos = line.indexOf("sent");
    expect(instancePos).toBeGreaterThanOrEqual(0);
    expect(msgPos).toBeGreaterThan(instancePos);
  });

  it("campos numéricos são convertidos para string corretamente", () => {
    workerLog("remarketing", "info", { count: 5 }, "batch done");
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("count=5");
  });

  it("sem campos → prefixo e mensagem sem chaves extras", () => {
    workerLog("takeover-timeout", "info", {}, "started");
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[takeover-timeout\]\s+started$|^\[takeover-timeout\] started$/);
  });

  it("múltiplos campos de contexto (OB-1 — correlação completa)", () => {
    workerLog("process-message", "error", {
      jobId: "j-5",
      conversationId: "conv-5",
      messageId: "msg-5",
      organizationId: "org-5",
    }, `failed err="timeout"`);
    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).toContain("jobId=j-5");
    expect(line).toContain("conversationId=conv-5");
    expect(line).toContain("messageId=msg-5");
    expect(line).toContain("organizationId=org-5");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-1 — takeover-timeout: processTakeoverTimeouts deve usar log estruturado
// (RED: formato atual é "Auto-released takeover for conversation X" — sem chave=valor)
// ════════════════════════════════════════════════════════════════════════════

const { mockGetExpiredTakeovers, mockReleaseExpiredTakeover } = vi.hoisted(() => ({
  mockGetExpiredTakeovers: vi.fn(),
  mockReleaseExpiredTakeover: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
  Queue: vi.fn().mockImplementation(() => ({ upsertJobScheduler: vi.fn() })),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getExpiredTakeovers: mockGetExpiredTakeovers,
  releaseExpiredTakeover: mockReleaseExpiredTakeover,
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  setConversationWaiting: vi.fn(),
  getInstanceById: vi.fn(),
  createAuditLog: vi.fn(),
  updateBillingEventStatus: vi.fn(),
}));

vi.mock("@aula-agente/queue", () => ({
  getConnectionOptions: vi.fn(() => ({})),
  getTakeoverTimeoutQueue: vi.fn(() => ({ upsertJobScheduler: vi.fn() })),
  getSendMessageQueue: vi.fn(() => ({ add: vi.fn() })),
  getRemarketingQueue: vi.fn(() => ({ add: vi.fn() })),
  getRedisConnection: vi.fn(() => ({ ping: vi.fn() })),
}));

vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: {
    PROCESS_MESSAGE: "process-message",
    SEND_MESSAGE: "send-message",
    TAKEOVER_TIMEOUT: "takeover-timeout",
    BILLING_ONBOARDING: "billing-onboarding",
  },
  HUMAN_TAKEOVER_TIMEOUT_MS: 3_600_000,
}));

vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../lib/lock", () => ({
  acquireConversationLock: vi.fn(async () => "lock-value"),
  releaseConversationLock: vi.fn(async () => {}),
}));
vi.mock("../lib/media-validation", () => ({ validateMediaPayload: vi.fn() }));
vi.mock("../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({ text: "ok", model: "gpt-4o", tokensUsed: 10, latencyMs: 50, toolCalls: [] })),
}));
vi.mock("../workers/evaluate-activation", () => ({
  evaluateActivation: vi.fn(async () => ({ action: "ignore" })),
}));
vi.mock("../agents/tools/close-conversation", () => ({
  CLOSE_CONVERSATION_TOOL_NAME: "close_conversation",
}));

import { processTakeoverTimeouts } from "../workers/takeover-timeout";

const mockTakeoverConversation = {
  id: "conv-takeover-1",
  organization_id: "org-tk-1",
  human_takeover_at: "2026-01-01T00:00:00Z",
};

describe("OB-1: processTakeoverTimeouts — campos estruturados nos logs", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("log de release inclui conversationId=<id> (não texto livre 'for conversation X')", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([mockTakeoverConversation]);
    mockReleaseExpiredTakeover.mockResolvedValue(true);

    await processTakeoverTimeouts();

    const allLines = logSpy.mock.calls.map((args) => String(args[0]));
    const releaseLine = allLines.find((l) => l.includes("conv-takeover-1"));
    expect(releaseLine).toBeDefined();
    expect(releaseLine).toContain("conversationId=conv-takeover-1");
  });

  it("log de release inclui organizationId=<id> (contexto de correlação OB-1)", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([mockTakeoverConversation]);
    mockReleaseExpiredTakeover.mockResolvedValue(true);

    await processTakeoverTimeouts();

    const allLines = logSpy.mock.calls.map((args) => String(args[0]));
    const releaseLine = allLines.find((l) => l.includes("conv-takeover-1"));
    expect(releaseLine).toContain("organizationId=org-tk-1");
  });

  it("log de erro inclui conversationId e organizationId (não texto livre)", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([mockTakeoverConversation]);
    mockReleaseExpiredTakeover.mockRejectedValue(new Error("DB timeout"));

    await processTakeoverTimeouts();

    const allErrLines = errorSpy.mock.calls.map((args) => String(args[0]));
    const errLine = allErrLines.find((l) => l.includes("conv-takeover-1"));
    expect(errLine).toBeDefined();
    expect(errLine).toContain("conversationId=conv-takeover-1");
    expect(errLine).toContain("organizationId=org-tk-1");
  });

  it("log de erro inclui mensagem de erro inline (OB-2 — sem contexto perdido)", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([mockTakeoverConversation]);
    mockReleaseExpiredTakeover.mockRejectedValue(new Error("fk_constraint_violation"));

    await processTakeoverTimeouts();

    const allErrLines = errorSpy.mock.calls.map((args) => String(args[0]));
    const errLine = allErrLines.find((l) => l.includes("conv-takeover-1"));
    expect(errLine).toContain("fk_constraint_violation");
  });
});
