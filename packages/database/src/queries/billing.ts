import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Plan,
  PlanGatewayMapping,
  Subscription,
  BillingEvent,
  BillingEventStatus,
  BillingEventType,
  BillingGateway,
  BillingInterval,
  SubscriptionStatus,
  Organization,
  OrganizationInvitation,
} from "@aula-agente/shared";

// ─── Plans ───────────────────────────────────────────────────────────────────

export async function getActivePlans(client: SupabaseClient) {
  const { data, error } = await client
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data as Plan[];
}

export async function getPlanBySlug(client: SupabaseClient, slug: string) {
  const { data, error } = await client
    .from("plans")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data as Plan;
}

// ─── Plan Gateway Mappings ────────────────────────────────────────────────────

export async function getPlanByGatewayProduct(
  client: SupabaseClient,
  gateway: BillingGateway,
  gatewayProductId: string
) {
  const { data, error } = await client
    .from("plan_gateway_mappings")
    .select("*, plans(*)")
    .eq("gateway", gateway)
    .eq("gateway_product_id", gatewayProductId)
    .eq("is_active", true)
    .single();
  if (error) throw error;
  return data as PlanGatewayMapping & { plans: Plan };
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscriptionByOrg(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client
    .from("subscriptions")
    .select("*")
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function createSubscription(
  client: SupabaseClient,
  subscription: Pick<
    Subscription,
    | "organization_id"
    | "plan_id"
    | "status"
    | "billing_interval"
    | "gateway"
    | "gateway_subscription_id"
    | "gateway_customer_id"
    | "current_period_start"
    | "current_period_end"
    | "metadata"
  >
) {
  const { data, error } = await client
    .from("subscriptions")
    .insert(subscription)
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function updateSubscriptionStatus(
  client: SupabaseClient,
  organizationId: string,
  status: SubscriptionStatus,
  extra?: Partial<Pick<Subscription, "cancelled_at" | "cancel_at_period_end" | "current_period_end">>
) {
  const { data, error } = await client
    .from("subscriptions")
    .update({ status, ...extra })
    .eq("organization_id", organizationId)
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

// ─── Billing Events ───────────────────────────────────────────────────────────

export async function createBillingEvent(
  client: SupabaseClient,
  event: Pick<
    BillingEvent,
    "idempotency_key" | "gateway" | "gateway_event_id" | "event_type" | "raw_payload"
  >
) {
  const { data, error } = await client
    .from("billing_events")
    .insert({ ...event, normalized_payload: {}, status: "pending" })
    .select()
    .single();
  if (error) throw error;
  return data as BillingEvent;
}

// Returns null on idempotency key conflict (duplicate webhook delivery)
export async function tryInsertBillingEvent(
  client: SupabaseClient,
  event: Pick<
    BillingEvent,
    "idempotency_key" | "gateway" | "gateway_event_id" | "event_type" | "raw_payload"
  >
): Promise<BillingEvent | null> {
  const { data, error } = await client
    .from("billing_events")
    .insert({ ...event, normalized_payload: {}, status: "pending" })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return null; // unique_violation — duplicate delivery
    throw error;
  }
  return data as BillingEvent;
}

export async function getBillingEventById(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from("billing_events")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as BillingEvent;
}

export async function getBillingEventByIdempotencyKey(
  client: SupabaseClient,
  idempotencyKey: string
) {
  const { data, error } = await client
    .from("billing_events")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data as BillingEvent | null;
}

// ─── Onboarding helpers ───────────────────────────────────────────────────────

export async function findPendingInvitationByEmail(
  client: SupabaseClient,
  email: string
): Promise<OrganizationInvitation | null> {
  const { data, error } = await client
    .from("organization_invitations")
    .select("*")
    .eq("email", email)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as OrganizationInvitation | null;
}

export async function findInvitationByEmailForResend(
  client: SupabaseClient,
  email: string
): Promise<OrganizationInvitation | null> {
  const { data, error } = await client
    .from("organization_invitations")
    .select("*")
    .eq("email", email)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as OrganizationInvitation | null;
}

export async function renewInvitationExpiry(
  client: SupabaseClient,
  invitationId: string,
  newExpiresAt: string
): Promise<OrganizationInvitation> {
  const { data, error } = await client
    .from("organization_invitations")
    .update({ expires_at: newExpiresAt })
    .eq("id", invitationId)
    .select()
    .single();
  if (error) throw error;
  return data as OrganizationInvitation;
}

export async function createOrganizationForBilling(
  client: SupabaseClient,
  org: {
    name: string;
    slug: string;
    plan_id: string;
    settings: { max_documents: number; max_agents: number; max_instances: number };
  }
): Promise<Organization> {
  const { data, error } = await client
    .from("organizations")
    .insert({
      name: org.name,
      slug: org.slug,
      plan: "free",              // legacy field — plan_id FK is authoritative
      plan_id: org.plan_id,
      onboarding_status: "pending_owner",
      settings: org.settings,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Organization;
}

export async function findSubscriptionByGatewayId(
  client: SupabaseClient,
  gateway: BillingGateway,
  gatewaySubscriptionId: string
): Promise<Subscription | null> {
  const { data, error } = await client
    .from("subscriptions")
    .select("*")
    .eq("gateway", gateway)
    .eq("gateway_subscription_id", gatewaySubscriptionId)
    .maybeSingle();
  if (error) throw error;
  return data as Subscription | null;
}

export async function updateOrganizationOnboardingStatus(
  client: SupabaseClient,
  organizationId: string,
  onboardingStatus: "pending_owner" | "active" | "suspended"
): Promise<void> {
  const { error } = await client
    .from("organizations")
    .update({ onboarding_status: onboardingStatus })
    .eq("id", organizationId);
  if (error) throw error;
}

export async function isSlugAvailable(client: SupabaseClient, slug: string): Promise<boolean> {
  const { data } = await client.from("organizations").select("id").eq("slug", slug).maybeSingle();
  return data === null;
}

export async function claimBillingEventForProcessing(
  client: SupabaseClient,
  id: string
): Promise<BillingEvent | null> {
  const { data, error } = await client
    .from("billing_events")
    .update({ status: "processing" })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data as BillingEvent;
}

export async function updateBillingEventStatus(
  client: SupabaseClient,
  id: string,
  status: BillingEventStatus,
  extra?: Partial<
    Pick<
      BillingEvent,
      | "normalized_payload"
      | "organization_id"
      | "subscription_id"
      | "error_message"
      | "processed_at"
      | "event_type"
    >
  >
) {
  const { data, error } = await client
    .from("billing_events")
    .update({ status, ...extra })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as BillingEvent;
}
