import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES, HUMAN_TAKEOVER_TIMEOUT_MS } from "@aula-agente/shared";
import type { TakeoverTimeoutJobData } from "@aula-agente/queue";
import { getTakeoverTimeoutQueue } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { getAdminClient, getExpiredTakeovers, releaseExpiredTakeover } from "@aula-agente/database";
import { fireAudit } from "../lib/audit";
import { workerLog } from "../lib/logger";
import { incrementMetric } from "../lib/metrics";
import { enqueueDeadLetter } from "../lib/dead-letter";

export async function processTakeoverTimeouts() {
  const db = getAdminClient();
  const expired = await getExpiredTakeovers(db, HUMAN_TAKEOVER_TIMEOUT_MS);

  for (const conversation of expired) {
    try {
      const released = await releaseExpiredTakeover(
        db,
        conversation.id,
        conversation.organization_id,
        conversation.human_takeover_at!
      );
      if (released) {
        fireAudit(db, {
          organization_id: conversation.organization_id,
          action: "conversation.takeover_expired",
          entity_type: "conversation",
          entity_id: conversation.id,
          metadata: { actor: "system" },
        });
        workerLog("takeover-timeout", "info", {
          conversationId: conversation.id,
          organizationId: conversation.organization_id,
        }, "takeover released");
        incrementMetric("takeover_timeout_released");
      }
    } catch (err) {
      workerLog("takeover-timeout", "error", {
        conversationId: conversation.id,
        organizationId: conversation.organization_id,
      }, `release failed err="${(err as Error).message}"`);
      incrementMetric("takeover_timeout_failed");
    }
  }

  if (expired.length > 0) {
    workerLog("takeover-timeout", "info", { count: expired.length }, `released ${expired.length} expired takeovers`);
  }
}

export function startTakeoverTimeoutWorker() {
  const worker = new Worker<TakeoverTimeoutJobData>(
    QUEUE_NAMES.TAKEOVER_TIMEOUT,
    async (_job: Job) => {
      await processTakeoverTimeouts();
    },
    {
      connection: getConnectionOptions(),
      concurrency: 1,
    }
  );

  // Schedule repeating job every 5 minutes
  const queue = getTakeoverTimeoutQueue();
  queue.upsertJobScheduler(
    "takeover-timeout-scheduler",
    { every: 5 * 60 * 1000 },
    { name: "check-expired-takeovers" }
  );

  worker.on("failed", (job, err) => {
    workerLog("takeover-timeout", "error", { jobId: job?.id }, `failed err="${err.message}"`);
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      enqueueDeadLetter({
        sourceQueue: QUEUE_NAMES.TAKEOVER_TIMEOUT,
        jobId: job.id,
        identifiers: {},
        attemptsMade: job.attemptsMade,
      }, err).catch(() => {});
    }
  });

  console.log("Takeover-timeout worker started (runs every 5 min)");
  return worker;
}
