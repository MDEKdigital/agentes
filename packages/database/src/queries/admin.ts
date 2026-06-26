import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subscription, BillingInterval, OrganizationInvitation } from "@aula-agente/shared";
import { getSubscriptionByOrg, createSubscription } from "./billing";

export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  onboarding_status: string;
  created_at: string;
  plan_id: string | null;
  owner_email: string | null;
  subscription: {
    id: string;
    status: string;
    gateway: string | null;
    gateway_subscription_id: string | null;
    billing_interval: string;
    current_period_start: string | null;
    current_period_end: string | null;
    trial_end: string | null;
    cancelled_at: string | null;
    cancel_at_period_end: boolean;
    metadata: Record<string, unknown>;
    plan: {
      id: string;
      name: string;
      slug: string;
      price_monthly: number;
      price_yearly: number;
      max_agents: number;
      max_members: number;
      max_instances: number;
    } | null;
  } | null;
  billing_events: Array<{
    id: string;
    event_type: string;
    status: string;
    gateway: string | null;
    created_at: string;
    error_message: string | null;
  }>;
}

export async function getAllOrganizationsWithSubscriptions(
  client: SupabaseClient
): Promise<AdminOrgRow[]> {
  const [orgsRes, subsRes, invRes, eventsRes] = await Promise.all([
    client
      .from("organizations")
      .select("id, name, slug, onboarding_status, created_at, plan_id")
      .order("created_at", { ascending: false }),
    client
      .from("subscriptions")
      .select(
        "id, organization_id, status, gateway, gateway_subscription_id, billing_interval, current_period_start, current_period_end, trial_end, cancelled_at, cancel_at_period_end, metadata, plans(id, name, slug, price_monthly, price_yearly, max_agents, max_members, max_instances)"
      ),
    client
      .from("organization_invitations")
      .select("organization_id, email")
      .eq("role", "owner")
      .order("created_at", { ascending: false }),
    client
      .from("billing_events")
      .select("id, organization_id, event_type, status, gateway, created_at, error_message")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (orgsRes.error) throw orgsRes.error;
  if (subsRes.error) throw subsRes.error;
  if (invRes.error) throw invRes.error;
  if (eventsRes.error) throw eventsRes.error;

  const subsByOrg = new Map(
    (subsRes.data ?? []).map((s: Record<string, unknown>) => [s.organization_id as string, s])
  );

  const emailByOrg = new Map<string, string>();
  for (const inv of (invRes.data ?? []) as Array<{ organization_id: string; email: string }>) {
    if (!emailByOrg.has(inv.organization_id)) {
      emailByOrg.set(inv.organization_id, inv.email);
    }
  }

  const eventsByOrg = new Map<string, AdminOrgRow["billing_events"]>();
  for (const ev of (eventsRes.data ?? []) as Array<{ organization_id: string | null } & Record<string, unknown>>) {
    if (!ev.organization_id) continue;
    const orgId = ev.organization_id as string;
    const list = eventsByOrg.get(orgId) ?? [];
    if (list.length < 20) {
      list.push(ev as unknown as AdminOrgRow["billing_events"][number]);
      eventsByOrg.set(orgId, list);
    }
  }

  return (orgsRes.data ?? []).map((org: Record<string, unknown>) => {
    const raw = subsByOrg.get(org.id as string) as Record<string, unknown> | undefined;
    return {
      id: org.id as string,
      name: org.name as string,
      slug: org.slug as string,
      onboarding_status: org.onboarding_status as string,
      created_at: org.created_at as string,
      plan_id: org.plan_id as string | null,
      owner_email: emailByOrg.get(org.id as string) ?? null,
      subscription: raw
        ? {
            id: raw.id as string,
            status: raw.status as string,
            gateway: raw.gateway as string | null,
            gateway_subscription_id: raw.gateway_subscription_id as string | null,
            billing_interval: raw.billing_interval as string,
            current_period_start: raw.current_period_start as string | null,
            current_period_end: raw.current_period_end as string | null,
            trial_end: raw.trial_end as string | null,
            cancelled_at: raw.cancelled_at as string | null,
            cancel_at_period_end: raw.cancel_at_period_end as boolean,
            metadata: (raw.metadata ?? {}) as Record<string, unknown>,
            plan: (raw.plans ?? null) as { id: string; name: string; slug: string; price_monthly: number; price_yearly: number; max_agents: number; max_members: number; max_instances: number } | null,
          }
        : null,
      billing_events: eventsByOrg.get(org.id as string) ?? [],
    };
  });
}

export async function createManualSubscription(
  client: SupabaseClient,
  orgId: string,
  planId: string,
  interval: BillingInterval
): Promise<Subscription> {
  const existing = await getSubscriptionByOrg(client, orgId);
  if (existing) {
    const err = new Error("SUBSCRIPTION_EXISTS") as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  }

  const sub = await createSubscription(client, {
    organization_id: orgId,
    plan_id: planId,
    status: "active",
    billing_interval: interval,
    gateway: null,
    gateway_subscription_id: null,
    gateway_customer_id: null,
    current_period_start: new Date().toISOString(),
    current_period_end: null,
    metadata: {},
  });

  await client.from("organizations").update({ plan_id: planId }).eq("id", orgId);
  return sub;
}

export async function updateSubscriptionAdmin(
  client: SupabaseClient,
  subId: string,
  fields: Partial<Pick<Subscription, "plan_id" | "status" | "current_period_end" | "billing_interval">>
): Promise<Subscription> {
  const { data, error } = await client
    .from("subscriptions")
    .update(fields)
    .eq("id", subId)
    .select()
    .single();
  if (error) throw error;
  const sub = data as Subscription;
  if (fields.plan_id) {
    await client.from("organizations").update({ plan_id: fields.plan_id }).eq("id", sub.organization_id);
  }
  return sub;
}

export async function cancelSubscriptionAdmin(
  client: SupabaseClient,
  subId: string
): Promise<Subscription> {
  const { data, error } = await client
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", subId)
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function findOwnerInvitationByOrg(
  client: SupabaseClient,
  orgId: string
): Promise<OrganizationInvitation | null> {
  const { data, error } = await client
    .from("organization_invitations")
    .select("*")
    .eq("organization_id", orgId)
    .eq("role", "owner")
    .eq("status", "pending")
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as OrganizationInvitation | null;
}
