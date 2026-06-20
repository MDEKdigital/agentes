import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES, HUMAN_TAKEOVER_TIMEOUT_MS } from "@aula-agente/shared";
import type { TakeoverTimeoutJobData } from "@aula-agente/queue";
import { getTakeoverTimeoutQueue } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { getAdminClient, getExpiredTakeovers, releaseExpiredTakeover } from "@aula-agente/database";
import { fireAudit } from "../lib/audit";

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
        console.log(`Auto-released takeover for conversation ${conversation.id}`);
      }
    } catch (err) {
      console.error(`Failed to release takeover for conversation ${conversation.id}:`, err);
    }
  }

  if (expired.length > 0) {
    console.log(`Released ${expired.length} expired takeovers`);
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
    console.error(`Takeover timeout job ${job?.id} failed:`, err.message);
  });

  console.log("Takeover-timeout worker started (runs every 5 min)");
  return worker;
}
