import type { getAdminClient } from "@aula-agente/database";
import type { BillingGateway, BillingInterval } from "@aula-agente/shared";

type DbClient = ReturnType<typeof getAdminClient>;
import type { NormalizedBillingEvent } from "../normalizers/index";
import {
  getPlanByGatewayProduct,
  getPlanBySlug,
  createSubscription,
  updateSubscriptionStatus,
  findPendingInvitationByEmail,
  createOrganizationForBilling,
  findSubscriptionByGatewayId,
  updateOrganizationOnboardingStatus,
  isSlugAvailable,
  updateBillingEventStatus,
  createInvitation,
} from "@aula-agente/database";
import { sendWelcomeEmail } from "./email-service";

// ─── Slug generation ─────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50) || "org";
}

async function generateUniqueSlug(client: DbClient, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let attempt = 1;
  while (!(await isSlugAvailable(client, slug))) {
    slug = `${base}-${++attempt}`;
    if (attempt > 100) throw new Error(`Cannot find unique slug for base: ${base}`);
  }
  return slug;
}

// ─── subscription.activated ──────────────────────────────────────────────────

export async function handleSubscriptionActivated(
  client: DbClient,
  billingEventId: string,
  normalized: NormalizedBillingEvent
): Promise<void> {
  if (!normalized.customer.email) {
    throw new Error("Cannot activate subscription: customer email is missing");
  }

  // 1. Resolve plan from gateway product mapping, then fall back to plan_slug in metadata
  let planId: string;
  let planName: string;

  try {
    const mapping = await getPlanByGatewayProduct(
      client,
      normalized.gateway,
      normalized.product.gateway_product_id
    );
    planId = mapping.plans.id;
    planName = mapping.plans.name;
  } catch {
    const planSlug = normalized.product.plan_slug;
    if (!planSlug) {
      throw new Error(
        `No plan mapping found for gateway=${normalized.gateway} product=${normalized.product.gateway_product_id}`
      );
    }
    const plan = await getPlanBySlug(client, planSlug);
    planId = plan.id;
    planName = plan.name;
  }

  // 2. Dedup: check for existing pending invitation for this email
  const existingInvitation = await findPendingInvitationByEmail(client, normalized.customer.email);

  let orgId: string;
  let invitationId: string;

  if (existingInvitation) {
    // Reuse existing org — resend email instead of creating duplicate
    orgId = existingInvitation.organization_id;
    invitationId = existingInvitation.id;
  } else {
    // 3. Create new org (no owner yet — owner created when invitation is accepted)
    const orgName = normalized.customer.name || normalized.customer.email;
    const slug = await generateUniqueSlug(client, orgName);

    const org = await createOrganizationForBilling(client, {
      name: orgName,
      slug,
      plan_id: planId,
      settings: { max_documents: 50, max_agents: 5, max_instances: 3 },
    });
    orgId = org.id;

    // 4. Create owner invitation (invited_by: null = system)
    const invitation = await createInvitation(client, {
      organization_id: orgId,
      email: normalized.customer.email,
      role: "owner",
      invited_by: null,
    });
    invitationId = invitation.id;
  }

  // 5. Create subscription
  const subscription = await createSubscription(client, {
    organization_id: orgId,
    plan_id: planId,
    status: "active",
    billing_interval: (normalized.subscription?.interval ?? "monthly") as BillingInterval,
    gateway: normalized.gateway as BillingGateway,
    gateway_subscription_id: normalized.subscription?.gateway_subscription_id ?? null,
    gateway_customer_id: normalized.subscription?.gateway_customer_id ?? null,
    current_period_start: normalized.subscription?.current_period_start ?? null,
    current_period_end: normalized.subscription?.current_period_end ?? null,
    metadata: normalized.metadata,
  });

  // 6. Mark billing event as processed
  await updateBillingEventStatus(client, billingEventId, "processed", {
    organization_id: orgId,
    subscription_id: subscription.id,
    processed_at: new Date().toISOString(),
    normalized_payload: normalized as unknown as Record<string, unknown>,
    event_type: "subscription.activated",
  });

  // 7. Send welcome email — non-fatal
  try {
    await sendWelcomeEmail({
      to: normalized.customer.email,
      name: normalized.customer.name || normalized.customer.email,
      invitationId,
      orgName: normalized.customer.name || "sua organização",
      planName,
    });
  } catch (err) {
    console.error(
      "[onboarding] Welcome email failed — invitation exists, user can request resend",
      err
    );
  }
}

// ─── subscription.renewed ────────────────────────────────────────────────────

export async function handleSubscriptionRenewed(
  client: DbClient,
  billingEventId: string,
  normalized: NormalizedBillingEvent
): Promise<void> {
  const gatewaySubscriptionId = normalized.subscription?.gateway_subscription_id;
  if (!gatewaySubscriptionId) {
    throw new Error("subscription.renewed: missing gateway_subscription_id");
  }

  const subscription = await findSubscriptionByGatewayId(
    client,
    normalized.gateway,
    gatewaySubscriptionId
  );
  if (!subscription) {
    throw new Error(
      `subscription.renewed: no subscription found for gateway_subscription_id=${gatewaySubscriptionId}`
    );
  }

  await updateSubscriptionStatus(client, subscription.organization_id, "active", {
    current_period_end: normalized.subscription?.current_period_end ?? undefined,
  });

  await updateBillingEventStatus(client, billingEventId, "processed", {
    organization_id: subscription.organization_id,
    subscription_id: subscription.id,
    processed_at: new Date().toISOString(),
    normalized_payload: normalized as unknown as Record<string, unknown>,
    event_type: "subscription.renewed",
  });
}

// ─── subscription.cancelled ──────────────────────────────────────────────────

export async function handleSubscriptionCancelled(
  client: DbClient,
  billingEventId: string,
  normalized: NormalizedBillingEvent
): Promise<void> {
  const gatewaySubscriptionId = normalized.subscription?.gateway_subscription_id;
  if (!gatewaySubscriptionId) {
    throw new Error("subscription.cancelled: missing gateway_subscription_id");
  }

  const subscription = await findSubscriptionByGatewayId(
    client,
    normalized.gateway,
    gatewaySubscriptionId
  );
  if (!subscription) {
    await updateBillingEventStatus(client, billingEventId, "ignored", {
      processed_at: new Date().toISOString(),
      event_type: "subscription.cancelled",
    });
    return;
  }

  await updateSubscriptionStatus(client, subscription.organization_id, "cancelled", {
    cancelled_at: new Date().toISOString(),
  });

  await updateOrganizationOnboardingStatus(client, subscription.organization_id, "suspended");

  await updateBillingEventStatus(client, billingEventId, "processed", {
    organization_id: subscription.organization_id,
    subscription_id: subscription.id,
    processed_at: new Date().toISOString(),
    normalized_payload: normalized as unknown as Record<string, unknown>,
    event_type: "subscription.cancelled",
  });
}

// ─── subscription.past_due ───────────────────────────────────────────────────

export async function handleSubscriptionPastDue(
  client: DbClient,
  billingEventId: string,
  normalized: NormalizedBillingEvent
): Promise<void> {
  const gatewaySubscriptionId = normalized.subscription?.gateway_subscription_id;
  if (!gatewaySubscriptionId) {
    throw new Error("subscription.past_due: missing gateway_subscription_id");
  }

  const subscription = await findSubscriptionByGatewayId(
    client,
    normalized.gateway,
    gatewaySubscriptionId
  );
  if (!subscription) {
    await updateBillingEventStatus(client, billingEventId, "ignored", {
      processed_at: new Date().toISOString(),
    });
    return;
  }

  await updateSubscriptionStatus(client, subscription.organization_id, "past_due");

  await updateBillingEventStatus(client, billingEventId, "processed", {
    organization_id: subscription.organization_id,
    subscription_id: subscription.id,
    processed_at: new Date().toISOString(),
    event_type: "subscription.past_due",
  });
}
