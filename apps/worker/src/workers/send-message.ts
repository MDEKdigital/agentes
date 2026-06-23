import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { SendMessageJobData } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { evolutionPost } from "../lib/evolution";
import { getAdminClient, getInstanceById } from "@aula-agente/database";
import { workerLog } from "../lib/logger";
import { incrementMetric } from "../lib/metrics";
import { enqueueDeadLetter } from "../lib/dead-letter";

async function sendEvolutionText(instanceName: string, phone: string, text: string): Promise<void> {
  await evolutionPost(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    number: phone,
    text,
  });
}

async function sendPresence(
  instanceName: string,
  phone: string,
  presence: "composing" | "paused"
): Promise<void> {
  try {
    await evolutionPost(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
      number: phone,
      options: { presence },
    });
  } catch (err) {
    console.warn(`sendPresence(${presence}) failed (non-fatal):`, (err as Error).message);
  }
}

export function typingDelay(text: string): Promise<void> {
  const len = text.length;
  let min: number, max: number;
  if (len <= 100) {
    min = 1000; max = 2000;
  } else if (len <= 300) {
    min = 2000; max = 4000;
  } else {
    min = 3000; max = 5000;
  }
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startSendMessageWorker() {
  const worker = new Worker<SendMessageJobData>(
    QUEUE_NAMES.SEND_MESSAGE,
    async (job) => {
      const { instanceId, phone, content, organizationId } = job.data;

      if (!content?.trim()) {
        workerLog("send-message", "warn", { jobId: job.id, messageId: job.data.messageId }, "empty content — skipping send");
        return;
      }

      const db = getAdminClient();
      const instance = await getInstanceById(db, instanceId, organizationId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found — cannot send message`);
      }

      await sendPresence(instance.instance_name, phone, "composing");
      try {
        await typingDelay(content);
        await sendEvolutionText(instance.instance_name, phone, content);
      } finally {
        await sendPresence(instance.instance_name, phone, "paused");
      }

      workerLog("send-message", "info", {
        jobId: job.id,
        conversationId: job.data.conversationId,
        messageId: job.data.messageId,
        instanceId,
        organizationId,
      }, "sent");
      incrementMetric("send_message_success");
    },
    {
      connection: getConnectionOptions(),
      concurrency: 20,
      // Worst case: sendPresence(30s) + typingDelay(5s) + sendEvolutionText(30s) + sendPresence paused(30s) = 95s.
      // 120s gives ~25s headroom so BullMQ stall-checker never fires on a healthy job.
      lockDuration: 120_000,
      limiter: {
        max: 30,
        duration: 1000,
      },
    }
  );

  worker.on("failed", (job, err) => {
    workerLog("send-message", "error", {
      jobId: job?.id,
      conversationId: job?.data.conversationId,
      messageId: job?.data.messageId,
      instanceId: job?.data.instanceId,
      organizationId: job?.data.organizationId,
    }, `failed err="${err.message}"`);
    incrementMetric("send_message_failed");
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      enqueueDeadLetter({
        sourceQueue: QUEUE_NAMES.SEND_MESSAGE,
        jobId: job.id,
        identifiers: { conversationId: job.data.conversationId, messageId: job.data.messageId, instanceId: job.data.instanceId, organizationId: job.data.organizationId },
        attemptsMade: job.attemptsMade,
      }, err).catch(() => {});
    }
  });

  console.log("Send-message worker started");
  return worker;
}
