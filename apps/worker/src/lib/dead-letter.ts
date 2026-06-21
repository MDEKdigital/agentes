import { getDeadLetterQueue } from "@aula-agente/queue";

export interface DeadLetterContext {
  sourceQueue: string;
  jobId: string | undefined;
  identifiers: Record<string, string | undefined>;
  attemptsMade: number;
}

export interface DeadLetterPayload {
  source_queue: string;
  job_id: string;
  identifiers: Record<string, string | undefined>;
  error_message: string;
  failed_at: string;
  attempts_made: number;
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/gi, "[REDACTED_KEY]")
    .replace(/[A-Za-z0-9+/]{50,}={0,2}/g, "[REDACTED_B64]")
    .slice(0, 500);
}

export async function enqueueDeadLetter(
  context: DeadLetterContext,
  err: Error
): Promise<void> {
  const jobId = context.jobId ?? "unknown";
  const payload: DeadLetterPayload = {
    source_queue: context.sourceQueue,
    job_id: jobId,
    identifiers: context.identifiers,
    error_message: sanitizeErrorMessage(err.message),
    failed_at: new Date().toISOString(),
    attempts_made: context.attemptsMade,
  };
  const queue = getDeadLetterQueue();
  await queue.add("dead-letter-entry", payload, {
    jobId: `dl_${context.sourceQueue}_${jobId}`,
    removeOnComplete: { count: 10_000 },
    removeOnFail: { count: 1_000 },
  });
}
