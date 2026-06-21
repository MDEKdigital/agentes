/**
 * RED tests for OB-8: process-document success path uses console.log instead of workerLog.
 *
 * Problem:
 *   After successfully processing a document (extract → chunk → embed → insert),
 *   the processor calls:
 *     console.log(`Processed document ${documentId}: ${chunks.length} chunks`);
 *   — no jobId, no organizationId, no agentId, no chunk count in structured fields.
 *   The failed handler for the same worker already uses workerLog("process-document",
 *   "error", { jobId, documentId, organizationId }, ...) — direct asymmetry.
 *
 * Fix:
 *   Replace console.log with workerLog("process-document", "info",
 *   { jobId: job.id, documentId, organizationId, agentId }, `processed N chunks`)
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockWorkerLog, capturedProcessors } = vi.hoisted(() => ({
  mockWorkerLog: vi.fn(),
  capturedProcessors: new Map<string, (...args: unknown[]) => unknown>(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({ workerLog: mockWorkerLog }));
vi.mock("../lib/metrics", () => ({ incrementMetric: vi.fn() }));
vi.mock("../lib/dead-letter", () => ({ enqueueDeadLetter: vi.fn() }));
vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(
    (name: string, processor: (...args: unknown[]) => unknown) => {
      capturedProcessors.set(name, processor);
      return { on: vi.fn() };
    }
  ),
}));

vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_DOCUMENT: "process-document" },
}));
vi.mock("@aula-agente/queue", () => ({
  getDeadLetterQueue: vi.fn(() => ({ add: vi.fn() })),
  getConnectionOptions: vi.fn(() => ({})),
}));

// Database mocks — default for success path
const mockGetDocumentById = vi.fn();
const mockUpdateDocument = vi.fn();
const mockInsertChunks = vi.fn();

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getDocumentById: (...args: unknown[]) => mockGetDocumentById(...args),
  updateDocument: (...args: unknown[]) => mockUpdateDocument(...args),
  insertChunks: (...args: unknown[]) => mockInsertChunks(...args),
}));

vi.mock("../lib/vault", () => ({
  resolveEmbeddingApiKey: vi.fn().mockResolvedValue("sk-embed-test"),
}));

vi.mock("../embeddings/chunker", () => ({
  chunkText: vi.fn(() => [
    { content: "chunk one", metadata: { chunk_index: 0 } },
    { content: "chunk two", metadata: { chunk_index: 1 } },
  ]),
}));

vi.mock("../embeddings/embedder", () => ({
  generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]),
}));

vi.mock("../lib/with-timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/with-timeout")>();
  return {
    ...actual,
    // withTimeout passes through promise in tests
    withTimeout: vi.fn().mockImplementation((p: Promise<unknown>) => p),
  };
});

vi.mock("pdf-parse", () => ({ default: vi.fn() }));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));

// Fetch mock for document download
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Import under test ─────────────────────────────────────────────────────────

import { startProcessDocumentWorker } from "../workers/process-document";

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_ID = "doc-001";
const ORG_ID = "org-001";
const AGENT_ID = "agent-001";
const JOB_ID = "job-001";

function makeJob(overrides = {}) {
  return {
    id: JOB_ID,
    data: { documentId: DOC_ID, organizationId: ORG_ID, agentId: AGENT_ID },
    log: vi.fn(),
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  startProcessDocumentWorker();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: successful document processing
  mockFetch.mockResolvedValue({
    ok: true,
    text: async () => "This is the document content that will be chunked.",
  });
  mockGetDocumentById.mockResolvedValue({
    id: DOC_ID,
    file_url: "https://storage.example.com/doc-001.txt",
    file_type: "txt",
  });
  mockUpdateDocument.mockResolvedValue({});
  mockInsertChunks.mockResolvedValue({});
});

// ════════════════════════════════════════════════════════════════════════════
// OB-8A — success path usa workerLog em vez de console.log
// ════════════════════════════════════════════════════════════════════════════

describe("OB-8A: process-document success — workerLog em vez de console.log", () => {
  it("workerLog é chamado após processamento bem-sucedido", async () => {
    const processor = capturedProcessors.get("process-document")!;
    await processor(makeJob(), {});

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "process-document",
      "info",
      expect.any(Object),
      expect.any(String)
    );
  });

  it("workerLog inclui documentId no contexto", async () => {
    const processor = capturedProcessors.get("process-document")!;
    await processor(makeJob(), {});

    const infoCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-document" && level === "info"
    );
    expect(infoCall).toBeDefined();
    const ctx = infoCall?.[2] as Record<string, unknown>;
    expect(ctx.documentId).toBe(DOC_ID);
  });

  it("workerLog inclui organizationId no contexto", async () => {
    const processor = capturedProcessors.get("process-document")!;
    await processor(makeJob(), {});

    const infoCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-document" && level === "info"
    );
    const ctx = infoCall?.[2] as Record<string, unknown>;
    expect(ctx.organizationId).toBe(ORG_ID);
  });

  it("workerLog inclui jobId no contexto", async () => {
    const processor = capturedProcessors.get("process-document")!;
    await processor(makeJob(), {});

    const infoCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-document" && level === "info"
    );
    const ctx = infoCall?.[2] as Record<string, unknown>;
    expect(ctx.jobId).toBe(JOB_ID);
  });

  it("mensagem de log menciona contagem de chunks", async () => {
    const processor = capturedProcessors.get("process-document")!;
    await processor(makeJob(), {});

    const infoCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-document" && level === "info"
    );
    const msg = infoCall?.[3] as string;
    // Should mention "2 chunks" (from our chunkText mock that returns 2 chunks)
    expect(msg).toMatch(/2.*chunk|chunk.*2/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-8B — assimetria corrigida: success e failure usam o mesmo padrão
// ════════════════════════════════════════════════════════════════════════════

describe("OB-8B: simetria entre success log e error log", () => {
  it("workerLog é chamado com worker='process-document' no sucesso (mesmo que no erro)", async () => {
    const processor = capturedProcessors.get("process-document")!;
    await processor(makeJob(), {});

    // ALL workerLog calls to "process-document" on the info path
    const processDocLogs = mockWorkerLog.mock.calls.filter(
      ([worker]) => worker === "process-document"
    );
    expect(processDocLogs.length).toBeGreaterThan(0);
  });

  it("nível é 'info' no caminho feliz (não 'error' nem 'warn')", async () => {
    const processor = capturedProcessors.get("process-document")!;
    await processor(makeJob(), {});

    const infoCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-document" && level === "info"
    );
    expect(infoCall).toBeDefined();
    expect(infoCall?.[1]).toBe("info");
  });
});
