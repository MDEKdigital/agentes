import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type {
  ProcessMessageJobData,
  SendMessageJobData,
  ProcessDocumentJobData,
  TakeoverTimeoutJobData,
  RemarketingJobData,
  BillingOnboardingJobData,
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
        // Fixed backoff (2 s) gives ~4 s of retry coverage while staying well under
        // INTER_PART_DELAY_MS (7 s), preserving multi-part delivery order on retry.
        backoff: { type: "fixed", delay: 2000 },
        // Large window so completed-part jobIds stay in Redis long enough for
        // process-message retries to deduplicate safely (prevents duplicate WhatsApp delivery).
        removeOnComplete: { count: 50_000 },
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
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "fixed", delay: 10000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return takeoverTimeoutQueue;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let remarketingQueue: Queue<RemarketingJobData, any, string> | null = null;

export function getRemarketingQueue() {
  if (!remarketingQueue) {
    remarketingQueue = new Queue<RemarketingJobData>(QUEUE_NAMES.REMARKETING, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return remarketingQueue;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deadLetterQueue: Queue<any, any, string> | null = null;

export function getDeadLetterQueue() {
  if (!deadLetterQueue) {
    deadLetterQueue = new Queue("dead-letter", {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: { count: 10_000 },
        removeOnFail: { count: 1_000 },
      },
    });
  }
  return deadLetterQueue;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billingOnboardingQueue: Queue<BillingOnboardingJobData, any, string> | null = null;

export function getBillingOnboardingQueue() {
  if (!billingOnboardingQueue) {
    billingOnboardingQueue = new Queue<BillingOnboardingJobData>(QUEUE_NAMES.BILLING_ONBOARDING, {
      connection: getConnectionOptions(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return billingOnboardingQueue;
}
