/**
 * RED tests for RC-4 and RC-5:
 * - RC-4: getRemarketingQueue must expose defaultJobOptions with retry ≥ 2
 * - RC-5: getTakeoverTimeoutQueue must expose defaultJobOptions with retry ≥ 2
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// ── Capture Queue constructor arguments ──────────────────────────────────────

interface CapturedOpts {
  defaultJobOptions?: {
    attempts?: number;
    backoff?: { type: string; delay: number };
    removeOnComplete?: { count: number } | boolean;
    removeOnFail?: { count: number } | boolean;
  };
}

const capturedArgs = new Map<string, CapturedOpts>();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string, opts: CapturedOpts) => {
    capturedArgs.set(name, opts ?? {});
    return { name, opts, on: vi.fn() };
  }),
}));

vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: {
    PROCESS_MESSAGE: "process-message",
    SEND_MESSAGE: "send-message",
    PROCESS_DOCUMENT: "process-document",
    TAKEOVER_TIMEOUT: "takeover-timeout",
    REMARKETING: "remarketing",
    BILLING_ONBOARDING: "billing-onboarding",
  },
}));

import {
  getRemarketingQueue,
  getTakeoverTimeoutQueue,
  getProcessMessageQueue,
  getSendMessageQueue,
  getProcessDocumentQueue,
  getBillingOnboardingQueue,
} from "@aula-agente/queue";

beforeAll(() => {
  // Trigger singleton creation for all queues to populate capturedArgs
  getRemarketingQueue();
  getTakeoverTimeoutQueue();
  getProcessMessageQueue();
  getSendMessageQueue();
  getProcessDocumentQueue();
  getBillingOnboardingQueue();
});

// ── RC-4: remarketing queue ───────────────────────────────────────────────────

describe("RC-4: getRemarketingQueue — retry policy", () => {
  it("tem defaultJobOptions explícito (não implícito)", () => {
    const opts = capturedArgs.get("remarketing");
    expect(opts).toBeDefined();
    expect(opts?.defaultJobOptions).toBeDefined();
  });

  it("attempts >= 2 (retry após falha transitória)", () => {
    const opts = capturedArgs.get("remarketing");
    expect(opts?.defaultJobOptions?.attempts).toBeGreaterThanOrEqual(2);
  });

  it("backoff está configurado", () => {
    const opts = capturedArgs.get("remarketing");
    expect(opts?.defaultJobOptions?.backoff).toBeDefined();
    expect(opts?.defaultJobOptions?.backoff?.type).toBeDefined();
    expect(opts?.defaultJobOptions?.backoff?.delay).toBeGreaterThan(0);
  });

  it("backoff type é 'exponential' (padrão do projeto)", () => {
    const opts = capturedArgs.get("remarketing");
    expect(opts?.defaultJobOptions?.backoff?.type).toBe("exponential");
  });

  it("removeOnComplete está configurado (evita acúmulo em Redis)", () => {
    const opts = capturedArgs.get("remarketing");
    expect(opts?.defaultJobOptions?.removeOnComplete).toBeDefined();
  });

  it("removeOnFail está configurado (evita acúmulo em Redis)", () => {
    const opts = capturedArgs.get("remarketing");
    expect(opts?.defaultJobOptions?.removeOnFail).toBeDefined();
  });
});

// ── RC-5: takeover-timeout queue ─────────────────────────────────────────────

describe("RC-5: getTakeoverTimeoutQueue — retry policy", () => {
  it("tem defaultJobOptions explícito (não implícito)", () => {
    const opts = capturedArgs.get("takeover-timeout");
    expect(opts).toBeDefined();
    expect(opts?.defaultJobOptions).toBeDefined();
  });

  it("attempts >= 2 (retry após falha transitória)", () => {
    const opts = capturedArgs.get("takeover-timeout");
    expect(opts?.defaultJobOptions?.attempts).toBeGreaterThanOrEqual(2);
  });

  it("backoff está configurado", () => {
    const opts = capturedArgs.get("takeover-timeout");
    expect(opts?.defaultJobOptions?.backoff).toBeDefined();
    expect(opts?.defaultJobOptions?.backoff?.type).toBeDefined();
    expect(opts?.defaultJobOptions?.backoff?.delay).toBeGreaterThan(0);
  });

  it("removeOnComplete está configurado", () => {
    const opts = capturedArgs.get("takeover-timeout");
    expect(opts?.defaultJobOptions?.removeOnComplete).toBeDefined();
  });

  it("removeOnFail está configurado", () => {
    const opts = capturedArgs.get("takeover-timeout");
    expect(opts?.defaultJobOptions?.removeOnFail).toBeDefined();
  });
});

// ── Guarda de regressão: filas existentes não foram alteradas ─────────────────

describe("Regressão: filas existentes preservam retry policy original", () => {
  it("process-message mantém attempts=3", () => {
    const opts = capturedArgs.get("process-message");
    expect(opts?.defaultJobOptions?.attempts).toBe(3);
  });

  it("send-message mantém attempts=3", () => {
    const opts = capturedArgs.get("send-message");
    expect(opts?.defaultJobOptions?.attempts).toBe(3);
  });

  it("process-document mantém attempts=2", () => {
    const opts = capturedArgs.get("process-document");
    expect(opts?.defaultJobOptions?.attempts).toBe(2);
  });

  it("billing-onboarding mantém attempts=5", () => {
    const opts = capturedArgs.get("billing-onboarding");
    expect(opts?.defaultJobOptions?.attempts).toBe(5);
  });

  it("process-message mantém backoff exponential", () => {
    const opts = capturedArgs.get("process-message");
    expect(opts?.defaultJobOptions?.backoff?.type).toBe("exponential");
  });

  it("billing-onboarding mantém backoff exponential", () => {
    const opts = capturedArgs.get("billing-onboarding");
    expect(opts?.defaultJobOptions?.backoff?.type).toBe("exponential");
  });
});
