import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES } from "@aula-agente/shared";
import type { BillingOnboardingJobData } from "@aula-agente/queue";
import { getConnectionOptions } from "../lib/redis";
import { getAdminClient, claimBillingEventForProcessing, updateBillingEventStatus } from "@aula-agente/database";
import { normalizePayload } from "../normalizers/index";
import {
  handleSubscriptionActivated,
  handleSubscriptionRenewed,
  handleSubscriptionCancelled,
  handleSubscriptionPastDue,
} from "../services/onboarding-service";

const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes

// C12: Reset a billing_event stuck in "processing" if it's older than STALE_PROCESSING_MS.
// Returns true if the event was stale and was successfully reset to "pending".
async function recoverStaleBillingEvent(
  client: ReturnType<typeof getAdminClient>,
  billingEventId: string
): Promise<boolean> {
  const staleAt = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data } = await client
    .from("billing_events")
    .update({ status: "pending" })
    .eq("id", billingEventId)
    .eq("status", "processing")
    .lt("updated_at", staleAt)
    .select("id")
    .single();
  return !!data;
}

async function processBillingOnboarding(job: Job<BillingOnboardingJobData>): Promise<void> {
  const { billingEventId } = job.data;
  const client = getAdminClient();

  // R4: Atomic claim — UPDATE WHERE status='pending' RETURNING; returns null if already claimed
  let billingEvent = await claimBillingEventForProcessing(client, billingEventId);

  if (!billingEvent) {
    // C12: Event may be stuck in "processing" from a previous hard crash.
    // If it's been there for > STALE_PROCESSING_MS, reset it and re-claim.
    const recovered = await recoverStaleBillingEvent(client, billingEventId);
    if (recovered) {
      billingEvent = await claimBillingEventForProcessing(client, billingEventId);
    }
  }

  if (!billingEvent) {
    job.log(`Skipping billing_event ${billingEventId}: not pending (already claimed or processed)`);
    return;
  }

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
    if (!job?.data.billingEventId) return;
    try {
      const client = getAdminClient();
      // C12: Don't overwrite a terminal state (processed/ignored) with "failed".
      // This prevents marking an event as failed when side effects already completed
      // (e.g., a concurrent stale-recovery path processed it while this retry failed).
      const { data: current } = await client
        .from("billing_events")
        .select("status")
        .eq("id", job.data.billingEventId)
        .single();
      if (current && ["processed", "ignored"].includes(current.status)) {
        console.warn(
          `[billing-onboarding] Job ${job.id} failed but event ${job.data.billingEventId} already ${current.status} — not overwriting`
        );
        return;
      }
      await updateBillingEventStatus(client, job.data.billingEventId, "failed", {
        error_message: err.message,
        processed_at: new Date().toISOString(),
      });
    } catch (updateErr) {
      console.error("[billing-onboarding] Failed to update billing_event status:", updateErr);
    }
  });

  return worker;
}
