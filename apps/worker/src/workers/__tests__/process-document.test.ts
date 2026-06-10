import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
}));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getDocumentById: vi.fn(),
  updateDocument: vi.fn(),
  insertChunks: vi.fn(),
}));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_DOCUMENT: "process-document" },
}));
vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../../lib/vault", () => ({ resolveEmbeddingApiKey: vi.fn(async () => "sk-embed") }));
vi.mock("../../embeddings/embedder", () => ({
  generateEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0))),
}));
vi.mock("pdf-parse", () => ({ default: vi.fn() }));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() }, extractRawText: vi.fn() }));

import { getDocumentById, updateDocument, insertChunks } from "@aula-agente/database";
import { resolveEmbeddingApiKey } from "../../lib/vault";
import { startProcessDocumentWorker } from "../process-document";

const jobData = { documentId: "doc-1", organizationId: "org-1", agentId: "agent-1" };

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

async function runJob() {
  const { Worker } = await import("bullmq");
  startProcessDocumentWorker();
  const workerInstance = vi.mocked(Worker).mock.results[0].value;
  await workerInstance._processor({ data: jobData });
}

describe("startProcessDocumentWorker", () => {
  it("atualiza status para error se o texto extraído for vazio", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: "doc-1",
      file_url: "http://example.com/doc.txt",
      file_type: "txt",
    } as never);

    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "   ",
    });

    await runJob();

    expect(updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      "doc-1",
      expect.objectContaining({ status: "error" })
    );
    expect(insertChunks).not.toHaveBeenCalled();
  });

  it("usa resolveEmbeddingApiKey passando o organizationId correto", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: "doc-1",
      file_url: "http://example.com/doc.txt",
      file_type: "txt",
    } as never);

    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "Conteúdo válido do documento",
    });

    await runJob();

    expect(resolveEmbeddingApiKey).toHaveBeenCalledWith("org-1");
  });

  it("caminho feliz: insere chunks e atualiza status para ready", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: "doc-1",
      file_url: "http://example.com/doc.txt",
      file_type: "txt",
    } as never);

    vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => "Conteúdo válido do documento para processamento",
    });

    await runJob();

    expect(insertChunks).toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      "doc-1",
      expect.objectContaining({ status: "ready" })
    );
  });
});
