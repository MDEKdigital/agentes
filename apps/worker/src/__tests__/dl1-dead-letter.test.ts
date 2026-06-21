/**
 * RED tests for DL-1: dead-letter trail for terminal worker failures.
 * - sanitizeErrorMessage unit tests
 * - enqueueDeadLetter payload contract
 * - worker on("failed") calls enqueueDeadLetter only on terminal failures
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// ── Dead-letter queue mock ────────────────────────────────────────────────────

const { mockDlqAdd } = vi.hoisted(() => ({
  mockDlqAdd: vi.fn().mockResolvedValue({ id: "dl-job-1" }),
}));

// ── Worker callback captures ──────────────────────────────────────────────────

const { capturedHandlers } = vi.hoisted(() => ({
  capturedHandlers: new Map<string, Map<string, (...args: unknown[]) => unknown>>(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((name: string, _processor: unknown) => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    capturedHandlers.set(name, handlers);
    return {
      on: vi.fn().mockImplementation((event: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(event, fn);
      }),
    };
  }),
  Queue: vi.fn().mockImplementation(() => ({ upsertJobScheduler: vi.fn(), add: vi.fn() })),
}));

vi.mock("@aula-agente/queue", () => ({
  getConnectionOptions: vi.fn(() => ({})),
  getDeadLetterQueue: vi.fn(() => ({ add: mockDlqAdd })),
  getSendMessageQueue: vi.fn(() => ({ add: vi.fn() })),
  getTakeoverTimeoutQueue: vi.fn(() => ({ upsertJobScheduler: vi.fn() })),
  getRemarketingQueue: vi.fn(() => ({ upsertJobScheduler: vi.fn(), add: vi.fn() })),
  getRedisConnection: vi.fn(() => ({ ping: vi.fn() })),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  setConversationWaiting: vi.fn().mockResolvedValue(true),
  getInstanceById: vi.fn(),
  createAuditLog: vi.fn(),
  getExpiredTakeovers: vi.fn().mockResolvedValue([]),
  releaseExpiredTakeover: vi.fn(),
  updateBillingEventStatus: vi.fn(),
  claimBillingEventForProcessing: vi.fn(),
}));

vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: {
    PROCESS_MESSAGE: "process-message",
    SEND_MESSAGE: "send-message",
    TAKEOVER_TIMEOUT: "takeover-timeout",
    BILLING_ONBOARDING: "billing-onboarding",
    REMARKETING: "remarketing",
  },
  HUMAN_TAKEOVER_TIMEOUT_MS: 3_600_000,
}));

vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../lib/lock", () => ({
  acquireConversationLock: vi.fn(async () => "lock-value"),
  releaseConversationLock: vi.fn(async () => {}),
  acquireEnrollmentLock: vi.fn(async () => "lock-value"),
  releaseEnrollmentLock: vi.fn(async () => {}),
}));
vi.mock("../lib/media-validation", () => ({ validateMediaPayload: vi.fn() }));
vi.mock("../lib/metrics", () => ({ incrementMetric: vi.fn() }));
vi.mock("../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({ text: "ok", model: "gpt-4o", tokensUsed: 10, latencyMs: 50, toolCalls: [] })),
}));
vi.mock("../workers/evaluate-activation", () => ({
  evaluateActivation: vi.fn(async () => ({ action: "ignore" })),
}));
vi.mock("../agents/tools/close-conversation", () => ({
  CLOSE_CONVERSATION_TOOL_NAME: "close_conversation",
}));

// ── Imports (RED: lib/dead-letter.ts does not exist) ─────────────────────────

import { enqueueDeadLetter, sanitizeErrorMessage } from "../lib/dead-letter";
import { startProcessMessageWorker } from "../workers/process-message";
import { startSendMessageWorker } from "../workers/send-message";
import { startTakeoverTimeoutWorker } from "../workers/takeover-timeout";

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  startProcessMessageWorker();
  startSendMessageWorker();
  startTakeoverTimeoutWorker();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDlqAdd.mockResolvedValue({ id: "dl-job-1" });
});

afterEach(() => vi.restoreAllMocks());

// ════════════════════════════════════════════════════════════════════════════
// DL-1 — sanitizeErrorMessage
// ════════════════════════════════════════════════════════════════════════════

describe("DL-1: sanitizeErrorMessage — remove dados sensíveis do erro", () => {
  it("preserva mensagem de erro normal sem modificação", () => {
    const result = sanitizeErrorMessage("Connection refused to database");
    expect(result).toBe("Connection refused to database");
  });

  it("remove sk- API keys (OpenAI pattern)", () => {
    const result = sanitizeErrorMessage("Invalid API key: sk-abc123DEF456abc123DEF456");
    expect(result).not.toContain("sk-abc123DEF456abc123DEF456");
    expect(result).toContain("[REDACTED_KEY]");
  });

  it("remove strings longas em base64 (>= 60 chars)", () => {
    const b64 = "dGVzdGluZ2Jhc2U2NGVuY29kaW5ndGVzdGluZ2Jhc2U2NGVuY29kaW5n";
    const result = sanitizeErrorMessage(`Error with payload ${b64}`);
    expect(result).not.toContain(b64);
    expect(result).toContain("[REDACTED_B64]");
  });

  it("trunca mensagens acima de 500 caracteres", () => {
    // Use spaces to avoid base64 detection — spaces aren't in [A-Za-z0-9+/]
    const long = ("Connection refused ").repeat(30); // ~570 chars
    const result = sanitizeErrorMessage(long);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(result.length).toBeGreaterThan(0);
  });

  it("não altera mensagem curta sem conteúdo sensível", () => {
    expect(sanitizeErrorMessage("timeout")).toBe("timeout");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-1 — enqueueDeadLetter payload
// ════════════════════════════════════════════════════════════════════════════

describe("DL-1: enqueueDeadLetter — payload contract", () => {
  const ctx = {
    sourceQueue: "process-message",
    jobId: "j-1",
    identifiers: { conversationId: "c-1", messageId: "m-1", organizationId: "o-1" },
    attemptsMade: 3,
  };

  it("enfileira no dead-letter queue via getDeadLetterQueue().add", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    expect(mockDlqAdd).toHaveBeenCalledOnce();
  });

  it("payload.source_queue indica qual fila originou a falha", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    const payload = mockDlqAdd.mock.calls[0][1] as { source_queue: string };
    expect(payload.source_queue).toBe("process-message");
  });

  it("payload.job_id corresponde ao job BullMQ", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    const payload = mockDlqAdd.mock.calls[0][1] as { job_id: string };
    expect(payload.job_id).toBe("j-1");
  });

  it("payload.identifiers contém os IDs de contexto passados", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    const payload = mockDlqAdd.mock.calls[0][1] as { identifiers: Record<string, string> };
    expect(payload.identifiers.conversationId).toBe("c-1");
    expect(payload.identifiers.messageId).toBe("m-1");
    expect(payload.identifiers.organizationId).toBe("o-1");
  });

  it("payload.error_message é string não vazia", async () => {
    await enqueueDeadLetter(ctx, new Error("LLM timeout"));
    const payload = mockDlqAdd.mock.calls[0][1] as { error_message: string };
    expect(payload.error_message).toBeTruthy();
    expect(payload.error_message).toContain("LLM timeout");
  });

  it("payload.failed_at é ISO timestamp válido", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    const payload = mockDlqAdd.mock.calls[0][1] as { failed_at: string };
    expect(() => new Date(payload.failed_at)).not.toThrow();
    expect(new Date(payload.failed_at).toISOString()).toBe(payload.failed_at);
  });

  it("payload.attempts_made reflete quantas tentativas foram feitas", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    const payload = mockDlqAdd.mock.calls[0][1] as { attempts_made: number };
    expect(payload.attempts_made).toBe(3);
  });

  it("jobId do enqueue é estável — dl_<queue>_<jobId> (idempotência)", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    const opts = mockDlqAdd.mock.calls[0][2] as { jobId: string };
    expect(opts.jobId).toBe("dl_process-message_j-1");
  });

  it("segunda chamada com mesmo contexto usa mesmo jobId (sem duplicata)", async () => {
    await enqueueDeadLetter(ctx, new Error("timeout"));
    await enqueueDeadLetter(ctx, new Error("timeout"));
    const id1 = (mockDlqAdd.mock.calls[0][2] as { jobId: string }).jobId;
    const id2 = (mockDlqAdd.mock.calls[1][2] as { jobId: string }).jobId;
    expect(id1).toBe(id2);
  });

  it("payload NÃO contém apiKey (sk- pattern)", async () => {
    await enqueueDeadLetter(ctx, new Error("failed with sk-abc123DEFxyzABC456"));
    const payload = mockDlqAdd.mock.calls[0][1] as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it("payload NÃO contém base64 longa bruta", async () => {
    const b64 = "dGVzdGluZ2Jhc2U2NGVuY29kaW5ndGVzdGluZ2Jhc2U2NGVuY29kaW5n";
    await enqueueDeadLetter(ctx, new Error(`failed with ${b64}`));
    const payload = mockDlqAdd.mock.calls[0][1] as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(b64);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-1 — process-message: DLQ só em falha terminal
// ════════════════════════════════════════════════════════════════════════════

describe("DL-1: process-message — DLQ apenas em falha terminal", () => {
  const jobData = { conversationId: "c-1", messageId: "m-1", agentId: "a-1", organizationId: "o-1" };

  it("falha terminal dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("process-message")?.get("failed");
    expect(handler).toBeDefined();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const terminalJob = { id: "j-pm-t", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("timeout"));

    // enqueueDeadLetter é async/fire-and-forget — aguardar microtasks
    await Promise.resolve();
    expect(mockDlqAdd).toHaveBeenCalled();
  });

  it("falha intermediária NÃO dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("process-message")?.get("failed");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const intermediateJob = { id: "j-pm-i", data: jobData, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(intermediateJob, new Error("transient error"));

    await Promise.resolve();
    expect(mockDlqAdd).not.toHaveBeenCalled();
  });

  it("DLQ de process-message inclui conversationId nos identifiers", async () => {
    const handler = capturedHandlers.get("process-message")?.get("failed");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const terminalJob = { id: "j-pm-ids", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("timeout"));
    await Promise.resolve();

    const payload = mockDlqAdd.mock.calls[0]?.[1] as { identifiers: Record<string, string> };
    expect(payload?.identifiers?.conversationId).toBe("c-1");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-1 — send-message: DLQ só em falha terminal
// ════════════════════════════════════════════════════════════════════════════

describe("DL-1: send-message — DLQ apenas em falha terminal", () => {
  const jobData = { conversationId: "c-1", messageId: "m-1", instanceId: "inst-1", phone: "55119", organizationId: "o-1", content: "oi" };

  it("falha terminal dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("send-message")?.get("failed");
    expect(handler).toBeDefined();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const terminalJob = { id: "j-sm-t", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("Evolution unreachable"));

    await Promise.resolve();
    expect(mockDlqAdd).toHaveBeenCalled();
  });

  it("falha intermediária NÃO dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("send-message")?.get("failed");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const intermediateJob = { id: "j-sm-i", data: jobData, attemptsMade: 2, opts: { attempts: 3 } };
    await handler?.(intermediateJob, new Error("transient"));

    await Promise.resolve();
    expect(mockDlqAdd).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-1 — takeover-timeout: DLQ em falha terminal do job
// ════════════════════════════════════════════════════════════════════════════

describe("DL-1: takeover-timeout — DLQ em falha terminal do job", () => {
  it("falha terminal do job de takeover dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("takeover-timeout")?.get("failed");
    expect(handler).toBeDefined();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const terminalJob = { id: "j-tk-t", data: {}, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("scheduler crash"));

    await Promise.resolve();
    expect(mockDlqAdd).toHaveBeenCalled();
  });

  it("falha intermediária de takeover NÃO dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("takeover-timeout")?.get("failed");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const intermediateJob = { id: "j-tk-i", data: {}, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(intermediateJob, new Error("transient"));

    await Promise.resolve();
    expect(mockDlqAdd).not.toHaveBeenCalled();
  });
});
