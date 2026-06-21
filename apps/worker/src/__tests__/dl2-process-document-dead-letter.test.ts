/**
 * RED tests for DL-2: dead-letter trail for process-document worker.
 *
 * Problem:
 *   process-document failed handler uses bare console.error — no workerLog,
 *   no incrementMetric, no enqueueDeadLetter. This means terminal document
 *   processing failures leave no dead-letter trail and no counter, making
 *   them invisible in operational monitoring.
 *
 * Fix:
 *   - Use workerLog (structured, not console.error)
 *   - incrementMetric("process_document_failed") on every failure
 *   - incrementMetric("process_document_success") on success
 *   - enqueueDeadLetter on terminal failure only
 *   - DLQ payload carries documentId + organizationId in identifiers
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ── Dead-letter mock ──────────────────────────────────────────────────────────

const { mockDlqAdd } = vi.hoisted(() => ({
  mockDlqAdd: vi.fn().mockResolvedValue({ id: "dl-doc-1" }),
}));

// ── Metrics mock ──────────────────────────────────────────────────────────────

const { mockIncrementMetric } = vi.hoisted(() => ({
  mockIncrementMetric: vi.fn(),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────

const { mockWorkerLog } = vi.hoisted(() => ({
  mockWorkerLog: vi.fn(),
}));

// ── Worker callback captures ──────────────────────────────────────────────────

const { capturedProcessors, capturedHandlers } = vi.hoisted(() => ({
  capturedProcessors: new Map<string, (...args: unknown[]) => unknown>(),
  capturedHandlers: new Map<string, Map<string, (...args: unknown[]) => unknown>>(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((name: string, processor: unknown) => {
    capturedProcessors.set(name, processor as (...args: unknown[]) => unknown);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    capturedHandlers.set(name, handlers);
    return {
      on: vi.fn().mockImplementation((event: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(event, fn);
      }),
    };
  }),
}));

vi.mock("@aula-agente/queue", () => ({
  getDeadLetterQueue: vi.fn(() => ({ add: mockDlqAdd })),
  getConnectionOptions: vi.fn(() => ({})),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getDocumentById: vi.fn().mockResolvedValue({
    id: "doc-1",
    file_url: "https://example.com/doc.txt",
    file_type: "txt",
  }),
  updateDocument: vi.fn().mockResolvedValue({}),
  insertChunks: vi.fn().mockResolvedValue({}),
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

vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../lib/vault", () => ({ resolveEmbeddingApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../lib/logger", () => ({ workerLog: mockWorkerLog }));
vi.mock("../lib/metrics", () => ({ incrementMetric: mockIncrementMetric }));
vi.mock("../lib/dead-letter", () => ({
  enqueueDeadLetter: vi.fn().mockResolvedValue(undefined),
  sanitizeErrorMessage: vi.fn((m: string) => m),
}));
vi.mock("../embeddings/chunker", () => ({
  chunkText: vi.fn(() => [{ content: "chunk 1", metadata: { chunk_index: 0 } }]),
}));
vi.mock("../embeddings/embedder", () => ({
  generateEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
}));
vi.mock("pdf-parse", () => ({ default: vi.fn() }));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));

// ── Import after mocks ────────────────────────────────────────────────────────

import { startProcessDocumentWorker } from "../workers/process-document";
import { enqueueDeadLetter } from "../lib/dead-letter";

const jobData = {
  documentId: "doc-1",
  organizationId: "org-1",
  agentId: "agent-1",
};

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  startProcessDocumentWorker();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDlqAdd.mockResolvedValue({ id: "dl-doc-1" });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-2A — failed handler usa workerLog (não console.error)
// ════════════════════════════════════════════════════════════════════════════

describe("DL-2A: process-document failed handler — usa workerLog em vez de console.error", () => {
  it("workerLog é chamado em qualquer falha", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");
    expect(handler).toBeDefined();

    const job = { id: "j-1", data: jobData, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(job, new Error("fetch timeout"));

    expect(mockWorkerLog).toHaveBeenCalled();
  });

  it("workerLog recebe worker='process-document'", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");

    const job = { id: "j-2", data: jobData, attemptsMade: 2, opts: { attempts: 3 } };
    await handler?.(job, new Error("embedding failed"));

    const call = mockWorkerLog.mock.calls[0] as unknown[];
    expect(call[0]).toBe("process-document");
  });

  it("workerLog inclui documentId no contexto", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");

    const job = { id: "j-3", data: jobData, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(job, new Error("some error"));

    const call = mockWorkerLog.mock.calls[0] as unknown[];
    const ctx = call[2] as Record<string, unknown>;
    expect(ctx).toHaveProperty("documentId", "doc-1");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-2B — incrementMetric("process_document_failed") em toda falha
// ════════════════════════════════════════════════════════════════════════════

describe("DL-2B: process-document failed handler — incrementMetric em toda falha", () => {
  it("incrementMetric('process_document_failed') é chamado em falha intermediária", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");

    const job = { id: "j-4", data: jobData, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(job, new Error("transient error"));

    expect(mockIncrementMetric).toHaveBeenCalledWith("process_document_failed");
  });

  it("incrementMetric('process_document_failed') é chamado em falha terminal", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");

    const job = { id: "j-5", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(job, new Error("terminal error"));

    expect(mockIncrementMetric).toHaveBeenCalledWith("process_document_failed");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-2C — enqueueDeadLetter apenas em falha terminal
// ════════════════════════════════════════════════════════════════════════════

describe("DL-2C: process-document — DLQ apenas em falha terminal", () => {
  it("falha terminal dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");
    expect(handler).toBeDefined();

    const terminalJob = { id: "j-t1", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("embedding API down"));

    await Promise.resolve();
    expect(enqueueDeadLetter).toHaveBeenCalled();
  });

  it("falha intermediária NÃO dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");

    const intermediateJob = { id: "j-i1", data: jobData, attemptsMade: 1, opts: { attempts: 3 } };
    await handler?.(intermediateJob, new Error("transient"));

    await Promise.resolve();
    expect(enqueueDeadLetter).not.toHaveBeenCalled();
  });

  it("primeira tentativa (attemptsMade=0) NÃO dispara enqueueDeadLetter", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");

    const firstAttemptJob = { id: "j-i2", data: jobData, attemptsMade: 0, opts: { attempts: 3 } };
    await handler?.(firstAttemptJob, new Error("first try"));

    await Promise.resolve();
    expect(enqueueDeadLetter).not.toHaveBeenCalled();
  });

  it("sem opts (default 1 tentativa) → attemptsMade=1 é terminal e dispara DLQ", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");

    const job = { id: "j-nopts", data: jobData, attemptsMade: 1 };
    await handler?.(job, new Error("single attempt failure"));

    await Promise.resolve();
    expect(enqueueDeadLetter).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-2D — DLQ payload identifiers
// ════════════════════════════════════════════════════════════════════════════

describe("DL-2D: process-document DLQ payload — identifiers corretos", () => {
  it("DLQ payload.identifiers contém documentId", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");
    const terminalJob = { id: "j-ids", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("timeout"));

    await Promise.resolve();

    const call = (enqueueDeadLetter as ReturnType<typeof vi.fn>).mock.calls[0];
    const ctx = call[0] as { identifiers: Record<string, string> };
    expect(ctx.identifiers.documentId).toBe("doc-1");
  });

  it("DLQ payload.identifiers contém organizationId", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");
    const terminalJob = { id: "j-ids2", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("timeout"));

    await Promise.resolve();

    const call = (enqueueDeadLetter as ReturnType<typeof vi.fn>).mock.calls[0];
    const ctx = call[0] as { identifiers: Record<string, string> };
    expect(ctx.identifiers.organizationId).toBe("org-1");
  });

  it("DLQ sourceQueue é PROCESS_DOCUMENT", async () => {
    const handler = capturedHandlers.get("process-document")?.get("failed");
    const terminalJob = { id: "j-src", data: jobData, attemptsMade: 3, opts: { attempts: 3 } };
    await handler?.(terminalJob, new Error("timeout"));

    await Promise.resolve();

    const call = (enqueueDeadLetter as ReturnType<typeof vi.fn>).mock.calls[0];
    const ctx = call[0] as { sourceQueue: string };
    expect(ctx.sourceQueue).toBe("process-document");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DL-2E — incrementMetric("process_document_success") no caminho feliz
// ════════════════════════════════════════════════════════════════════════════

describe("DL-2E: process-document success — incrementMetric no caminho feliz", () => {
  it("incrementMetric('process_document_success') é chamado quando processamento completa", async () => {
    // Mock fetch for the processor
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "Some document content to process",
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal("fetch", mockFetch);

    const processor = capturedProcessors.get("process-document");
    expect(processor).toBeDefined();

    const job = {
      id: "j-success",
      data: jobData,
      log: vi.fn(),
    };

    await processor?.(job);

    expect(mockIncrementMetric).toHaveBeenCalledWith("process_document_success");

    vi.unstubAllGlobals();
  });
});
