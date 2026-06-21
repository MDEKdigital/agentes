import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { ProcessDocumentJobData } from "@aula-agente/queue";
import type { DocumentFileType } from "@aula-agente/shared";
import { getConnectionOptions } from "../lib/redis";
import { getAdminClient, getDocumentById, updateDocument, insertChunks } from "@aula-agente/database";
import { resolveEmbeddingApiKey } from "../lib/vault";
import { chunkText } from "../embeddings/chunker";
import { generateEmbeddings } from "../embeddings/embedder";
import { workerLog } from "../lib/logger";
import { incrementMetric } from "../lib/metrics";
import { enqueueDeadLetter } from "../lib/dead-letter";
import { withTimeout, DOCUMENT_FETCH_TIMEOUT_MS, EMBEDDING_TIMEOUT_MS } from "../lib/with-timeout";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractText(url: string, fileType: DocumentFileType): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOCUMENT_FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Falha ao buscar documento: ${response.status}`);
  }

  if (fileType === "pdf") {
    const buffer = Buffer.from(await response.arrayBuffer());
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (fileType === "docx") {
    const buffer = Buffer.from(await response.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  return response.text();
}

export function startProcessDocumentWorker() {
  const worker = new Worker<ProcessDocumentJobData>(
    QUEUE_NAMES.PROCESS_DOCUMENT,
    async (job) => {
      const { documentId, organizationId, agentId } = job.data;
      const db = getAdminClient();

      try {
        // Load document
        const document = await getDocumentById(db, documentId);

        // Extract text
        const text = await extractText(document.file_url, document.file_type as DocumentFileType);

        if (!text.trim()) {
          await updateDocument(db, documentId, {
            status: "error",
            error_message: "No text content extracted from document",
          });
          return;
        }

        // Chunk text
        const chunks = chunkText(text);

        // Resolve API key for embeddings (always uses OpenAI for embeddings)
        const apiKey = await resolveEmbeddingApiKey(organizationId);

        // Generate embeddings
        const embeddings = await withTimeout(
          generateEmbeddings(chunks.map((c) => c.content), apiKey),
          EMBEDDING_TIMEOUT_MS
        );

        if (embeddings.length !== chunks.length) {
          throw new Error(
            `Embedding count mismatch: got ${embeddings.length} for ${chunks.length} chunks`
          );
        }

        // Insert chunks with embeddings
        await insertChunks(
          db,
          chunks.map((chunk, i) => ({
            document_id: documentId,
            organization_id: organizationId,
            content: chunk.content,
            metadata: chunk.metadata as Record<string, unknown>,
            embedding: embeddings[i],
            chunk_index: chunk.metadata.chunk_index,
          }))
        );

        // Update document status
        await updateDocument(db, documentId, {
          status: "ready",
          chunk_count: chunks.length,
        });

        console.log(`Processed document ${documentId}: ${chunks.length} chunks`);
        incrementMetric("process_document_success");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await updateDocument(db, documentId, {
          status: "error",
          error_message: message,
        });
        throw error;
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 3,
    }
  );

  worker.on("failed", (job, err) => {
    workerLog("process-document", "error", { jobId: job?.id, documentId: job?.data.documentId, organizationId: job?.data.organizationId }, `failed err="${err.message}"`);
    incrementMetric("process_document_failed");
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      enqueueDeadLetter({
        sourceQueue: QUEUE_NAMES.PROCESS_DOCUMENT,
        jobId: job.id,
        identifiers: { documentId: job.data.documentId, organizationId: job.data.organizationId },
        attemptsMade: job.attemptsMade,
      }, err).catch(() => {});
    }
  });

  console.log("Process-document worker started");
  return worker;
}
