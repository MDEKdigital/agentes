/**
 * RED tests for RC-7: process-document external call timeouts.
 *
 * Problem:
 *   extractText() calls fetch(url) without any AbortSignal — a slow/hung
 *   document download blocks the BullMQ worker slot indefinitely until
 *   BullMQ's own stall detection (default 30s) kicks in, which can cause
 *   the job to be re-queued as "stalled" rather than failed.
 *
 *   generateEmbeddings() calls the OpenAI embedding API via AI SDK with no
 *   timeout wrapper — same stall risk for embedding generation.
 *
 * Fix:
 *   - Export DOCUMENT_FETCH_TIMEOUT_MS and EMBEDDING_TIMEOUT_MS from with-timeout.ts
 *   - extractText: add AbortSignal.timeout(DOCUMENT_FETCH_TIMEOUT_MS) to fetch call
 *   - generateEmbeddings call: wrap with withTimeout(..., EMBEDDING_TIMEOUT_MS)
 *   - Export extractText from process-document.ts for direct testability
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks needed for process-document imports ─────────────────────────

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: {
    PROCESS_MESSAGE: "process-message",
    SEND_MESSAGE: "send-message",
    PROCESS_DOCUMENT: "process-document",
  },
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

vi.mock("@aula-agente/queue", () => ({
  getDeadLetterQueue: vi.fn(() => ({ add: vi.fn() })),
  getConnectionOptions: vi.fn(() => ({})),
}));

vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../lib/vault", () => ({ resolveEmbeddingApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../lib/logger", () => ({ workerLog: vi.fn() }));
vi.mock("../lib/metrics", () => ({ incrementMetric: vi.fn() }));
vi.mock("../lib/dead-letter", () => ({
  enqueueDeadLetter: vi.fn().mockResolvedValue(undefined),
  sanitizeErrorMessage: vi.fn((m: string) => m),
}));
vi.mock("../embeddings/chunker", () => ({
  chunkText: vi.fn(() => [{ content: "chunk", metadata: { chunk_index: 0 } }]),
}));
vi.mock("../embeddings/embedder", () => ({
  generateEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
}));
vi.mock("pdf-parse", () => ({ default: vi.fn().mockResolvedValue({ text: "pdf text" }) }));
vi.mock("mammoth", () => ({
  default: { extractRawText: vi.fn().mockResolvedValue({ value: "docx text" }) },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  DOCUMENT_FETCH_TIMEOUT_MS,
  EMBEDDING_TIMEOUT_MS,
  LLM_TIMEOUT_MS,
  withTimeout,
} from "../lib/with-timeout";
import { extractText } from "../workers/process-document";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

// ════════════════════════════════════════════════════════════════════════════
// RC-7A — constantes exportadas de with-timeout.ts
// ════════════════════════════════════════════════════════════════════════════

describe("RC-7A: constantes de timeout para process-document — exportadas de with-timeout.ts", () => {
  it("DOCUMENT_FETCH_TIMEOUT_MS é exportado e positivo", () => {
    expect(DOCUMENT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("DOCUMENT_FETCH_TIMEOUT_MS é razoável para download de documento (10s–5min)", () => {
    expect(DOCUMENT_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(DOCUMENT_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it("EMBEDDING_TIMEOUT_MS é exportado e positivo", () => {
    expect(EMBEDDING_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("EMBEDDING_TIMEOUT_MS é razoável para chamada de embedding API (5s–2min)", () => {
    expect(EMBEDDING_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(EMBEDDING_TIMEOUT_MS).toBeLessThanOrEqual(2 * 60_000);
  });

  it("EMBEDDING_TIMEOUT_MS <= LLM_TIMEOUT_MS (embeddings são mais rápidos que LLM)", () => {
    expect(EMBEDDING_TIMEOUT_MS).toBeLessThanOrEqual(LLM_TIMEOUT_MS);
  });

  it("withTimeout ainda está exportado e funciona (sem regressão)", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 5000);
    expect(result).toBe("ok");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-7B — extractText exportado e testável diretamente
// ════════════════════════════════════════════════════════════════════════════

describe("RC-7B: extractText — exportado de process-document.ts", () => {
  it("extractText é exportado e é função async", async () => {
    expect(typeof extractText).toBe("function");
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "content" });
    const result = extractText("http://x.com/doc.txt", "txt");
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-7C — extractText usa AbortSignal.timeout no fetch
// ════════════════════════════════════════════════════════════════════════════

describe("RC-7C: extractText — fetch com AbortSignal.timeout", () => {
  it("AbortSignal.timeout é chamado durante o fetch de documento txt", async () => {
    const abortTimeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "document content",
    });

    await extractText("https://example.com/doc.txt", "txt");

    expect(abortTimeoutSpy).toHaveBeenCalled();
    expect(abortTimeoutSpy).toHaveBeenCalledWith(DOCUMENT_FETCH_TIMEOUT_MS);
  });

  it("AbortSignal.timeout é chamado para fetch de documento pdf", async () => {
    const abortTimeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Buffer.from("fake-pdf"),
    });

    await extractText("https://example.com/doc.pdf", "pdf").catch(() => {});

    expect(abortTimeoutSpy).toHaveBeenCalled();
    expect(abortTimeoutSpy).toHaveBeenCalledWith(DOCUMENT_FETCH_TIMEOUT_MS);
  });

  it("AbortSignal.timeout é chamado para fetch de documento docx", async () => {
    const abortTimeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Buffer.from("fake-docx"),
    });

    await extractText("https://example.com/doc.docx", "docx").catch(() => {});

    expect(abortTimeoutSpy).toHaveBeenCalled();
    expect(abortTimeoutSpy).toHaveBeenCalledWith(DOCUMENT_FETCH_TIMEOUT_MS);
  });

  it("AbortError de download propagado — não swallowed em extractText", async () => {
    const abortError = new DOMException("This operation was aborted", "AbortError");
    mockFetch.mockRejectedValue(abortError);

    await expect(extractText("https://example.com/slow.txt", "txt")).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("fetch 404 → extractText lança erro (não timeout)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(extractText("https://example.com/missing.txt", "txt")).rejects.toThrow("404");
  });

  it("fluxo nominal txt — retorna texto do documento", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "conteúdo do documento",
    });

    const result = await extractText("https://example.com/doc.txt", "txt");
    expect(result).toBe("conteúdo do documento");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-7D — withTimeout no caminho de embedding (invariante estrutural)
// ════════════════════════════════════════════════════════════════════════════

describe("RC-7D: EMBEDDING_TIMEOUT_MS — invariante estrutural", () => {
  it("withTimeout rejeita quando promise não resolve dentro do limite (valida a utilidade)", async () => {
    const neverResolves = new Promise<number[][]>(() => {});
    await expect(withTimeout(neverResolves, 50)).rejects.toThrow(/timed out/i);
  }, 5000);

  it("EMBEDDING_TIMEOUT_MS é suficientemente longo para batches reais (>= 30s)", () => {
    expect(EMBEDDING_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("DOCUMENT_FETCH_TIMEOUT_MS é suficientemente longo para arquivos grandes (>= 30s)", () => {
    expect(DOCUMENT_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });
});
