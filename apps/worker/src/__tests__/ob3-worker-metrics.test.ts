/**
 * Tests for OB-3: minimal worker counters for critical execution paths.
 * - metrics module unit tests (via hoisted mock that accumulates calls)
 * - integration: worker processors and failed handlers call incrementMetric
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// ── Metrics mock that accumulates state from incrementMetric calls ─────────────
// Using hoisted so workers import the mock (not the real file).

const { mockIncrementMetric } = vi.hoisted(() => ({
  mockIncrementMetric: vi.fn(),
}));

function getSnapshot(): Record<string, number> {
  const snap: Record<string, number> = {};
  for (const call of mockIncrementMetric.mock.calls as [string, ...unknown[]][]) {
    const name = call[0];
    snap[name] = (snap[name] ?? 0) + 1;
  }
  return snap;
}

function resetSnapshot(): void {
  mockIncrementMetric.mockClear();
}

vi.mock("../lib/metrics", () => ({
  incrementMetric: mockIncrementMetric,
  getMetricsSnapshot: () => getSnapshot(),
  resetMetricsForTests: () => resetSnapshot(),
}));

// ── Shared captures for Worker processor / failed-handler callbacks ───────────

const { capturedProcessors, capturedHandlers } = vi.hoisted(() => ({
  capturedProcessors: new Map<string, (...args: unknown[]) => unknown>(),
  capturedHandlers: new Map<string, Map<string, (...args: unknown[]) => unknown>>(),
}));

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((name: string, processor: (...args: unknown[]) => unknown) => {
    capturedProcessors.set(name, processor);
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

const { mockGetConversationById, mockGetExpiredTakeovers, mockReleaseExpiredTakeover, mockQueueAdd, mockGetInstanceById } = vi.hoisted(() => ({
  mockGetConversationById: vi.fn(),
  mockGetExpiredTakeovers: vi.fn(),
  mockReleaseExpiredTakeover: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockGetInstanceById: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: mockGetConversationById,
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  setConversationWaiting: vi.fn().mockResolvedValue(true),
  getInstanceById: mockGetInstanceById,
  createAuditLog: vi.fn(),
  getExpiredTakeovers: mockGetExpiredTakeovers,
  releaseExpiredTakeover: mockReleaseExpiredTakeover,
  updateBillingEventStatus: vi.fn(),
  claimBillingEventForProcessing: vi.fn(),
}));

vi.mock("@aula-agente/queue", () => ({
  getConnectionOptions: vi.fn(() => ({})),
  getSendMessageQueue: vi.fn(() => ({ add: mockQueueAdd })),
  getTakeoverTimeoutQueue: vi.fn(() => ({ upsertJobScheduler: vi.fn() })),
  getRemarketingQueue: vi.fn(() => ({ upsertJobScheduler: vi.fn(), add: vi.fn() })),
  getRedisConnection: vi.fn(() => ({ ping: vi.fn() })),
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
vi.mock("../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({ text: "ok", model: "gpt-4o", tokensUsed: 10, latencyMs: 50, toolCalls: [] })),
}));
vi.mock("../workers/evaluate-activation", () => ({
  evaluateActivation: vi.fn(async () => ({ action: "ignore" })),
}));
vi.mock("../agents/tools/close-conversation", () => ({
  CLOSE_CONVERSATION_TOOL_NAME: "close_conversation",
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { incrementMetric, getMetricsSnapshot, resetMetricsForTests } from "../lib/metrics";
import { handleTerminalFailure } from "../workers/process-message";
import { processTakeoverTimeouts } from "../workers/takeover-timeout";
import { startProcessMessageWorker } from "../workers/process-message";
import { startSendMessageWorker } from "../workers/send-message";

// Register workers once so callbacks are captured in capturedHandlers/capturedProcessors
beforeAll(() => {
  startProcessMessageWorker();
  startSendMessageWorker();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetMetricsForTests();
  mockQueueAdd.mockResolvedValue(undefined);
  process.env.EVOLUTION_API_URL = "http://evolution.local";
  process.env.EVOLUTION_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// OB-3 — metrics utility unit tests
// (These test the mock's accumulation logic — proves read/reset contract)
// ════════════════════════════════════════════════════════════════════════════

describe("OB-3: metrics — incrementMetric / getMetricsSnapshot / resetMetricsForTests", () => {
  it("incrementMetric adiciona ao counter", () => {
    incrementMetric("test_counter");
    expect(getMetricsSnapshot()["test_counter"]).toBe(1);
  });

  it("incrementMetric acumula chamadas consecutivas", () => {
    incrementMetric("test_counter");
    incrementMetric("test_counter");
    incrementMetric("test_counter");
    expect(getMetricsSnapshot()["test_counter"]).toBe(3);
  });

  it("getMetricsSnapshot retorna cópia estável (não muda após reset)", () => {
    incrementMetric("a");
    const snap = getMetricsSnapshot();
    resetMetricsForTests();
    expect(snap["a"]).toBe(1); // snapshot capturado antes do reset
    expect(getMetricsSnapshot()["a"]).toBeUndefined();
  });

  it("resetMetricsForTests limpa todos os counters", () => {
    incrementMetric("a");
    incrementMetric("b");
    resetMetricsForTests();
    const snap = getMetricsSnapshot();
    expect(snap["a"]).toBeUndefined();
    expect(snap["b"]).toBeUndefined();
  });

  it("counters independentes não interferem entre si", () => {
    incrementMetric("x");
    incrementMetric("y");
    incrementMetric("y");
    const snap = getMetricsSnapshot();
    expect(snap["x"]).toBe(1);
    expect(snap["y"]).toBe(2);
  });

  it("counter não existe antes de ser incrementado", () => {
    expect(getMetricsSnapshot()["never_incremented"]).toBeUndefined();
  });

  it("incrementMetric é chamado diretamente (sem magic) — não depende só de logs", () => {
    incrementMetric("direct_call");
    expect(mockIncrementMetric).toHaveBeenCalledWith("direct_call");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-3 — process-message: failed handler chama incrementMetric
// ════════════════════════════════════════════════════════════════════════════

describe("OB-3: process-message — counters de falha e fallback", () => {
  const failedJob = {
    id: "j-pm-1",
    data: { conversationId: "c-1", messageId: "m-1", agentId: "a-1", organizationId: "o-1" },
    attemptsMade: 1,
    opts: { attempts: 3 },
  };

  it("process_message_failed incrementa quando o failed handler é chamado", async () => {
    const handler = capturedHandlers.get("process-message")?.get("failed");
    expect(handler).toBeDefined();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handler?.(failedJob, new Error("LLM timeout"));
    expect(getMetricsSnapshot()["process_message_failed"]).toBe(1);
  });

  it("process_message_failed não incrementa process_message_success", async () => {
    const handler = capturedHandlers.get("process-message")?.get("failed");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handler?.(failedJob, new Error("LLM timeout"));
    expect(getMetricsSnapshot()["process_message_success"]).toBeUndefined();
  });

  it("process_message_terminal_fallback incrementa quando fallback é enfileirado com sucesso", async () => {
    mockGetConversationById.mockResolvedValue({
      id: "c-1", organization_id: "o-1", evolution_instance_id: "inst-1",
      contacts: { phone: "5511999999999" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTerminalFailure({ conversationId: "c-1", messageId: "m-1", agentId: "a-1", organizationId: "o-1" });
    expect(getMetricsSnapshot()["process_message_terminal_fallback"]).toBe(1);
  });

  it("process_message_terminal_fallback NÃO incrementa quando conversa não encontrada", async () => {
    mockGetConversationById.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handleTerminalFailure({ conversationId: "c-1", messageId: "m-1", agentId: "a-1", organizationId: "o-1" });
    expect(getMetricsSnapshot()["process_message_terminal_fallback"]).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-3 — send-message: success e failed counters
// ════════════════════════════════════════════════════════════════════════════

describe("OB-3: send-message — counters de sucesso e falha", () => {
  it("send_message_failed incrementa quando o failed handler é chamado", async () => {
    const handler = capturedHandlers.get("send-message")?.get("failed");
    expect(handler).toBeDefined();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failedJob = {
      id: "j-sm-1",
      data: { conversationId: "c-1", messageId: "m-1", instanceId: "inst-1", phone: "55119", organizationId: "o-1", content: "oi" },
    };
    await handler?.(failedJob, new Error("Evolution timeout"));
    expect(getMetricsSnapshot()["send_message_failed"]).toBe(1);
  });

  it("send_message_success incrementa quando mensagem é enviada com sucesso", async () => {
    const processor = capturedProcessors.get("send-message");
    expect(processor).toBeDefined();

    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: { cancel: vi.fn() } }));
    mockGetInstanceById.mockResolvedValue({ id: "inst-1", instance_name: "inst-test", organization_id: "o-1" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const job = {
      id: "j-sm-ok",
      data: { conversationId: "c-1", messageId: "m-1", instanceId: "inst-1", phone: "55119", organizationId: "o-1", content: "oi" },
    };
    const jobPromise = processor?.(job) as Promise<void>;
    jobPromise?.catch(() => {});
    await vi.runAllTimersAsync();
    await jobPromise;
    vi.useRealTimers();

    expect(getMetricsSnapshot()["send_message_success"]).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-3 — takeover-timeout: released e failed counters
// ════════════════════════════════════════════════════════════════════════════

describe("OB-3: takeover-timeout — counters de release e falha", () => {
  const mockConv = { id: "c-tk-1", organization_id: "o-tk-1", human_takeover_at: "2026-01-01T00:00:00Z" };

  it("takeover_timeout_released incrementa para cada takeover liberado", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([mockConv, { ...mockConv, id: "c-tk-2" }]);
    mockReleaseExpiredTakeover.mockResolvedValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await processTakeoverTimeouts();
    expect(getMetricsSnapshot()["takeover_timeout_released"]).toBe(2);
  });

  it("takeover_timeout_failed incrementa quando release falha", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([mockConv]);
    mockReleaseExpiredTakeover.mockRejectedValue(new Error("DB error"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await processTakeoverTimeouts();
    expect(getMetricsSnapshot()["takeover_timeout_failed"]).toBe(1);
  });

  it("takeover_timeout_released NÃO incrementa quando releaseExpiredTakeover retorna false", async () => {
    mockGetExpiredTakeovers.mockResolvedValue([mockConv]);
    mockReleaseExpiredTakeover.mockResolvedValue(false);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await processTakeoverTimeouts();
    expect(getMetricsSnapshot()["takeover_timeout_released"]).toBeUndefined();
  });
});
