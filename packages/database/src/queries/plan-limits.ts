import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanResource = "agents" | "instances" | "members";

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  max: number | null;
}

const RESOURCE_TABLE: Record<PlanResource, string> = {
  agents: "agents",
  instances: "evolution_instances",
  members: "organization_members",
};

const RESOURCE_LIMIT_KEY: Record<PlanResource, "max_agents" | "max_instances" | "max_members"> = {
  agents: "max_agents",
  instances: "max_instances",
  members: "max_members",
};

export async function getOrgPlanLimits(
  client: SupabaseClient,
  organizationId: string
): Promise<{ max_agents: number; max_instances: number; max_members: number } | null> {
  const { data: sub } = await client
    .from("subscriptions")
    .select("plan_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (!sub?.plan_id) return null;

  const { data: plan } = await client
    .from("plans")
    .select("max_agents, max_instances, max_members")
    .eq("id", sub.plan_id)
    .single();

  if (!plan) return null;

  return {
    max_agents: plan.max_agents,
    max_instances: plan.max_instances,
    max_members: plan.max_members,
  };
}

export async function checkResourceLimit(
  client: SupabaseClient,
  organizationId: string,
  resource: PlanResource
): Promise<LimitCheckResult> {
  const limits = await getOrgPlanLimits(client, organizationId);

  if (!limits) {
    return { allowed: true, current: 0, max: null };
  }

  const max = limits[RESOURCE_LIMIT_KEY[resource]];

  const { count } = await client
    .from(RESOURCE_TABLE[resource])
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  const current = count ?? 0;

  return { allowed: current < max, current, max };
}
