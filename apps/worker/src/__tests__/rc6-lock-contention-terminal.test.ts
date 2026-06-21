/**
 * RED tests for RC-6: Lock contention consuming BullMQ retry slots and
 * triggering spurious terminal failure.
 *
 * Problem:
 *   acquireConversationLock waits MAX_RETRIES×500ms = 10s, then returns null.
 *   The caller (process-message) throws a plain Error. BullMQ counts each
 *   throw as a failed attempt. With attempts=3 and exponential backoff
 *   (2s, 4s), the job exhausts all retries in ~36s total. But LLM_TIMEOUT_MS
 *   = 120s, meaning a lock holder can be legitimately active for 120s.
 *
 *   Result: when M2 arrives while M1 is being processed, Job B exhausts its
 *   BullMQ retries after ~36s and isTerminalFailure fires handleTerminalFailure
 *   → sends "Tivemos uma instabilidade técnica" to the user. This is a
 *   SPURIOUS error — lock contention is a valid operational state, NOT a real
 *   processing failure.
 *
 * Fix:
 *   - Introduce LockContentionError (exported from lock.ts)
 *   - acquireConversationLock throws LockContentionError when exhausted
 *   - In process-message failed handler: skip handleTerminalFailure when
 *     err instanceof LockContentionError (dead-letter still fires)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockRedisSet = vi.fn();

vi.mock("@aula-agente/queue", () => ({
  getRedisConnection: vi.fn(() => ({
    set: mockRedisSet,
    call: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

// ── DB / queue mocks for handleTerminalFailure ────────────────────────────────

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getConversationById: vi.fn().mockResolvedValue(null),
}));

vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: {
    PROCESS_MESSAGE: "process-message",
    SEND_MESSAGE: "send-message",
  },
}));

vi.mock("../lib/metrics", () => ({
  incrementMetric: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  workerLog: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  LockContentionError,
  acquireConversationLock,
  LOCK_RENEWAL_INTERVAL_MS,
} from "../lib/lock";
import {
  isTerminalFailure,
  handleTerminalFailure,
} from "../workers/process-message";
import { LLM_TIMEOUT_MS } from "../lib/with-timeout";

// ════════════════════════════════════════════════════════════════════════════
// RC-6A — LockContentionError class exported and identifiable
// ════════════════════════════════════════════════════════════════════════════

describe("RC-6A: LockContentionError — classe exportada e identificável", () => {
  it("LockContentionError é exportado de lock.ts", () => {
    expect(LockContentionError).toBeDefined();
  });

  it("instanceof Error (BullMQ pode capturar e fazer retry)", () => {
    const err = new LockContentionError("conv-1");
    expect(err).toBeInstanceOf(Error);
  });

  it("instanceof LockContentionError (distinguível no failed handler)", () => {
    const err = new LockContentionError("conv-1");
    expect(err).toBeInstanceOf(LockContentionError);
  });

  it("name = 'LockContentionError' para logging claro", () => {
    const err = new LockContentionError("conv-1");
    expect(err.name).toBe("LockContentionError");
  });

  it("message inclui conversationId para rastreabilidade", () => {
    const err = new LockContentionError("conv-xyz-456");
    expect(err.message).toContain("conv-xyz-456");
  });

  it("plain Error NÃO é LockContentionError — instanceof é preciso", () => {
    const plain = new Error("lock failed");
    expect(plain instanceof LockContentionError).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-6B — acquireConversationLock throws LockContentionError when exhausted
// Uses fake timers to avoid real 10s wait
// ════════════════════════════════════════════════════════════════════════════

describe("RC-6B: acquireConversationLock — lança LockContentionError ao esgotar retries", () => {
  it("retorna string quando lock adquirida com sucesso (nominal)", async () => {
    mockRedisSet.mockResolvedValue("OK");
    const val = await acquireConversationLock("conv-nominal");
    expect(typeof val).toBe("string");
    expect(val!.length).toBeGreaterThan(0);
  });

  it("lança LockContentionError quando Redis nunca retorna OK", async () => {
    vi.useFakeTimers();
    mockRedisSet.mockResolvedValue(null); // lock held by another job

    const promise = acquireConversationLock("conv-locked");
    // Attach rejection handler immediately to prevent unhandled rejection warning
    // while fake timers are being drained synchronously.
    const settled = promise.then(() => null).catch((e: unknown) => e);

    await vi.runAllTimersAsync();

    const err = await settled;
    expect(err).toBeInstanceOf(LockContentionError);
    vi.useRealTimers();
  });

  it("o erro é LockContentionError, não plain Error genérico", async () => {
    vi.useFakeTimers();
    mockRedisSet.mockResolvedValue(null);

    const promise = acquireConversationLock("conv-locked");
    const settled = promise.then(() => null).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const err = await settled;
    expect((err as LockContentionError).name).toBe("LockContentionError");
    vi.useRealTimers();
  });

  it("LockContentionError ainda é instanceof Error (BullMQ faz retry)", async () => {
    vi.useFakeTimers();
    mockRedisSet.mockResolvedValue(null);

    const promise = acquireConversationLock("conv-locked");
    const settled = promise.then(() => null).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    vi.useRealTimers();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-6C — Structural invariants proving the operational risk
// ════════════════════════════════════════════════════════════════════════════

describe("RC-6C: invariantes estruturais que provam o risco operacional", () => {
  it("LLM_TIMEOUT_MS > BullMQ total wait — confirma gap que causava terminal espúrio", () => {
    // Without fix:
    //   MAX_LOCK_WAIT_PER_ATTEMPT = 20 × 500ms = 10_000ms
    //   BullMQ total = 10s + 2s + 10s + 4s + 10s = 36s
    //   LLM_TIMEOUT_MS = 120s → 84s gap where M2 dies terminally but lock is valid
    const maxLockWaitPerAttempt = 20 * 500; // 10_000ms
    const bullmqAttempts = 3;
    const bullmqBackoff = 2000 + 4000; // exponential 2s + 4s
    const totalBullMQWait =
      maxLockWaitPerAttempt * bullmqAttempts + bullmqBackoff;

    expect(LLM_TIMEOUT_MS).toBeGreaterThan(totalBullMQWait);
  });

  it("heartbeat mantém lock vivo durante toda a chamada LLM — contention persiste", () => {
    const heartbeatsInLLMWindow = Math.floor(LLM_TIMEOUT_MS / LOCK_RENEWAL_INTERVAL_MS);
    expect(heartbeatsInLLMWindow).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-6D — isTerminalFailure unchanged (regression guard)
// ════════════════════════════════════════════════════════════════════════════

describe("RC-6D: isTerminalFailure — comportamento inalterado", () => {
  it("true quando attemptsMade >= attempts (falha terminal real)", () => {
    expect(isTerminalFailure({ attemptsMade: 3, opts: { attempts: 3 } })).toBe(true);
  });

  it("false quando há tentativas restantes (retry intermediário)", () => {
    expect(isTerminalFailure({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
  });

  it("false na primeira tentativa", () => {
    expect(isTerminalFailure({ attemptsMade: 0, opts: { attempts: 3 } })).toBe(false);
  });

  it("true sem opts (default 1 tentativa)", () => {
    expect(isTerminalFailure({ attemptsMade: 1 })).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-6E — LockContentionError distinguishable in failed handler
// ════════════════════════════════════════════════════════════════════════════

describe("RC-6E: failed handler — LockContentionError é distinguível de falha real", () => {
  it("LockContentionError instanceof LockContentionError → true", () => {
    const err = new LockContentionError("conv-1");
    expect(err instanceof LockContentionError).toBe(true);
  });

  it("Error de processamento real NÃO é LockContentionError", () => {
    const realFailure = new Error("DB connection refused");
    expect(realFailure instanceof LockContentionError).toBe(false);
  });

  it("RangeError NÃO é LockContentionError", () => {
    const rangeErr = new RangeError("out of range");
    expect(rangeErr instanceof LockContentionError).toBe(false);
  });

  it("handleTerminalFailure existe e é chamável sem quebrar (falha real com conv=null)", async () => {
    const { getConversationById } = await import("@aula-agente/database");
    vi.mocked(getConversationById).mockResolvedValue(null as never);

    await expect(
      handleTerminalFailure({
        conversationId: "conv-1",
        messageId: "msg-1",
        organizationId: "org-1",
        agentId: "agent-1",
      })
    ).resolves.toBeUndefined();
  });
});
