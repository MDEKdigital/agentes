/**
 * OB-5 regression guard — takeover_timeout_cycle_failed in failed handler.
 *
 * Problem:
 *   takeover-timeout worker's failed handler was missing incrementMetric("takeover_timeout_cycle_failed").
 *   Without this metric, job-level scheduler failures are invisible (only per-takeover
 *   metrics takeover_timeout_released / takeover_timeout_failed were present).
 *
 * Fix (OB-5): added incrementMetric("takeover_timeout_cycle_failed") at the top of the
 *   failed handler — fires on every failure, before the terminal check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted shared state ──────────────────────────────────────────────────────

const { mockIncrementMetric, capturedHandlers } = vi.hoisted(() => ({
  mockIncrementMetric: vi.fn(),
  capturedHandlers: new Map<string, Map<string, (...args: unknown[]) => unknown>>(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((name: string) => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    capturedHandlers.set(name, handlers);
    return {
      on: vi.fn().mockImplementation((event: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(event, fn);
      }),
    };
  }),
  Queue: vi.fn().mockImplementation(() => ({ upsertJobScheduler: vi.fn() })),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getExpiredTakeovers: vi.fn().mockResolvedValue([]),
  releaseExpiredTakeover: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@aula-agente/queue", () => ({
  getDeadLetterQueue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({}) })),
  getTakeoverTimeoutQueue: vi.fn(() => ({ upsertJobScheduler: vi.fn() })),
  getConnectionOptions: vi.fn(() => ({})),
}));

vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: {
    PROCESS_MESSAGE: "process-message",
    SEND_MESSAGE: "send-message",
    TAKEOVER_TIMEOUT: "takeover-timeout",
    REMARKETING: "remarketing",
    BILLING_ONBOARDING: "billing-onboarding",
  },
  HUMAN_TAKEOVER_TIMEOUT_MS: 3_600_000,
}));

vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("../lib/logger", () => ({ workerLog: vi.fn() }));
vi.mock("../lib/metrics", () => ({ incrementMetric: mockIncrementMetric }));
vi.mock("../lib/dead-letter", () => ({
  enqueueDeadLetter: vi.fn().mockResolvedValue(undefined),
  sanitizeErrorMessage: vi.fn((m: string) => m),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { startTakeoverTimeoutWorker } from "../workers/takeover-timeout";

// ── Test suite ────────────────────────────────────────────────────────────────

let workerStarted = false;

beforeEach(() => {
  vi.clearAllMocks();
  if (!workerStarted) {
    vi.spyOn(console, "log").mockImplementation(() => {});
    startTakeoverTimeoutWorker();
    workerStarted = true;
  }
});

describe("OB-5: takeover-timeout failed handler — incrementMetric", () => {
  it("failed handler chama incrementMetric('takeover_timeout_cycle_failed')", async () => {
    const handler = capturedHandlers.get("takeover-timeout")?.get("failed");
    expect(handler).toBeDefined();

    const job = { id: "j-tk-1", data: {}, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(job, new Error("scheduler crash"));

    expect(mockIncrementMetric).toHaveBeenCalledWith("takeover_timeout_cycle_failed");
  });

  it("incrementMetric é chamado antes de verificar se é terminal (toda falha, não só a terminal)", async () => {
    const handler = capturedHandlers.get("takeover-timeout")?.get("failed");

    const intermediateJob = { id: "j-tk-2", data: {}, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(intermediateJob, new Error("transient DB error"));

    expect(mockIncrementMetric).toHaveBeenCalledWith("takeover_timeout_cycle_failed");
  });

  it("takeover_timeout_cycle_failed é independente de takeover_timeout_released e takeover_timeout_failed", () => {
    expect("takeover_timeout_cycle_failed").not.toBe("takeover_timeout_released");
    expect("takeover_timeout_cycle_failed").not.toBe("takeover_timeout_failed");
  });
});
