import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { BillingOnboardingJobData } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { getAdminClient, getBillingEventById, updateBillingEventStatus } from "@aula-agente/database";
import { normalizePayload } from "../normalizers/index";
import {
  handleSubscriptionActivated,
  handleSubscriptionRenewed,
  handleSubscriptionCancelled,
  handleSubscriptionPastDue,
} from "../services/onboarding-service";

async function processBillingOnboarding(job: Job<BillingOnboardingJobData>): Promise<void> {
  const { billingEventId } = job.data;
  const client = getAdminClient();

  // 1. Fetch event
  const billingEvent = await getBillingEventById(client, billingEventId);

  // 2. Guard: skip if already processed (worker restart safety)
  if (billingEvent.status !== "pending") {
    job.log(`Skipping billing_event ${billingEventId}: status=${billingEvent.status}`);
    return;
  }

  // 3. Mark as processing
  await updateBillingEventStatus(client, billingEventId, "processing");

  // 4. Normalize raw payload
  const normalized = normalizePayload(
    billingEvent.gateway as Parameters<typeof normalizePayload>[0],
    billingEvent.raw_payload as Record<string, unknown>
  );

  job.log(`gateway=${billingEvent.gateway} event_type=${normalized.event_type}`);

  // 5. Dispatch by event type
  switch (normalized.event_type) {
    case "subscription.activated":
      await handleSubscriptionActivated(client, billingEventId, normalized);
      break;

    case "subscription.renewed":
      await handleSubscriptionRenewed(client, billingEventId, normalized);
      break;

    case "subscription.cancelled":
      await handleSubscriptionCancelled(client, billingEventId, normalized);
      break;

    case "subscription.past_due":
      await handleSubscriptionPastDue(client, billingEventId, normalized);
      break;

    case "subscription.reactivated":
      // Treat like renewal
      await handleSubscriptionRenewed(client, billingEventId, normalized);
      break;

    default:
      // refund.processed, unknown — mark as ignored, no action needed
      await updateBillingEventStatus(client, billingEventId, "ignored", {
        processed_at: new Date().toISOString(),
        normalized_payload: normalized as unknown as Record<string, unknown>,
        event_type: normalized.event_type,
      });
      job.log(`Event type ${normalized.event_type} marked as ignored`);
      break;
  }
}

export function createBillingOnboardingWorker() {
  const worker = new Worker<BillingOnboardingJobData>(
    QUEUE_NAMES.BILLING_ONBOARDING,
    processBillingOnboarding,
    {
      connection: getConnectionOptions(),
      concurrency: 5,
    }
  );

  worker.on("failed", async (job, err) => {
    console.error(`[billing-onboarding] Job ${job?.id} failed:`, err.message);
    if (job?.data.billingEventId) {
      try {
        await updateBillingEventStatus(getAdminClient(), job.data.billingEventId, "failed", {
          error_message: err.message,
          processed_at: new Date().toISOString(),
        });
      } catch (updateErr) {
        console.error("[billing-onboarding] Failed to update billing_event status:", updateErr);
      }
    }
  });

  return worker;
}
