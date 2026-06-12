import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { SendMessageJobData } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { evolutionPost } from "../lib/evolution";
import { getAdminClient, getInstanceById } from "@aula-agente/database";

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

function randomDelay(min = 3000, max = 8000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startSendMessageWorker() {
  const worker = new Worker<SendMessageJobData>(
    QUEUE_NAMES.SEND_MESSAGE,
    async (job) => {
      const { instanceId, phone, content } = job.data;

      const db = getAdminClient();
      const instance = await getInstanceById(db, instanceId);
      if (!instance) {
        throw new Error(`Instance ${instanceId} not found — cannot send message`);
      }

      await sendPresence(instance.instance_name, phone, "composing");
      await randomDelay();
      try {
        await sendEvolutionText(instance.instance_name, phone, content);
      } finally {
        await sendPresence(instance.instance_name, phone, "paused");
      }

      console.log(`Sent message to ${phone} via instance ${instance.instance_name}`);
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
    console.error(`Send job ${job?.id} failed:`, err.message);
  });

  console.log("Send-message worker started");
  return worker;
}
