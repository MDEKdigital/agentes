import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type {
  ProcessMessageJobData,
  SendMessageJobData,
  ProcessDocumentJobData,
  TakeoverTimeoutJobData,
} from "./types";

function getConnectionOptions() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  return { url: redisUrl };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processMessageQueue: Queue<ProcessMessageJobData, any, string> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sendMessageQueue: Queue<SendMessageJobData, any, string> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processDocumentQueue: Queue<ProcessDocumentJobData, any, string> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let takeoverTimeoutQueue: Queue<TakeoverTimeoutJobData, any, string> | null = null;

export function getProcessMessageQueue() {
  if (!processMessageQueue) {
    processMessageQueue = new Queue<ProcessMessageJobData>(QUEUE_NAMES.PROCESS_MESSAGE, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return processMessageQueue;
}

export function getSendMessageQueue() {
  if (!sendMessageQueue) {
    sendMessageQueue = new Queue<SendMessageJobData>(QUEUE_NAMES.SEND_MESSAGE, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return sendMessageQueue;
}

export function getProcessDocumentQueue() {
  if (!processDocumentQueue) {
    processDocumentQueue = new Queue<ProcessDocumentJobData>(QUEUE_NAMES.PROCESS_DOCUMENT, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return processDocumentQueue;
}

export function getTakeoverTimeoutQueue() {
  if (!takeoverTimeoutQueue) {
    takeoverTimeoutQueue = new Queue<TakeoverTimeoutJobData>(QUEUE_NAMES.TAKEOVER_TIMEOUT, {
      connection: getConnectionOptions(),
    });
  }
  return takeoverTimeoutQueue;
}
