import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { SendMessageJobData } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { evolutionPost } from "../lib/evolution";
import { getAdminClient, getInstanceById } from "@aula-agente/database";
import { workerLog } from "../lib/logger";

export function splitMessage(text: string): string[] {
  const parts = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [text.trim()];
  if (parts.length <= 3) return parts;
  return [...parts.slice(0, 2), parts.slice(2).join("\n\n")];
}

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

function shortPause(): Promise<void> {
  const ms = Math.floor(Math.random() * 501) + 500;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startSendMessageWorker() {
  const worker = new Worker<SendMessageJobData>(
    QUEUE_NAMES.SEND_MESSAGE,
    async (job) => {
      const { instanceId, phone, content, organizationId } = job.data;

      const db = getAdminClient();
      const instance = await getInstanceById(db, instanceId, organizationId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found — cannot send message`);
      }

      await sendPresence(instance.instance_name, phone, "composing");
      await typingDelay(content);
      try {
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
    },
    {
      connection: getConnectionOptions(),
      concurrency: 20,
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
  });

  console.log("Send-message worker started");
  return worker;
}
