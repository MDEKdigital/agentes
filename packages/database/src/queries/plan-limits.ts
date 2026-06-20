import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvolutionInstance } from "@aula-agente/shared";

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
  const { data } = await client
    .from("subscriptions")
    .select("plans(max_agents, max_instances, max_members)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  const plan = (data as any)?.plans;
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
  const [limits, countResult] = await Promise.all([
    getOrgPlanLimits(client, organizationId),
    client
      .from(RESOURCE_TABLE[resource])
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId),
  ]);

  const current = (countResult as any).count ?? 0;

  if (!limits) {
    return { allowed: true, current, max: null };
  }

  const max = limits[RESOURCE_LIMIT_KEY[resource]];
  return { allowed: current < max, current, max };
}

/**
 * C6: Atomic invitation creation — calls a DB function that checks the member count
 * and inserts the invitation in a single operation, eliminating the TOCTOU window.
 * Returns null when the limit is already reached (concurrent request won the race).
 *
 * Production requires the PostgreSQL function `create_invitation_if_under_member_limit`.
 */
export async function createInvitationAtomically(
  client: SupabaseClient,
  organizationId: string,
  data: { email: string; role: string; invited_by: string }
): Promise<{ id: string; [key: string]: unknown } | null> {
  const { data: result, error } = await (client as any).rpc(
    "create_invitation_if_under_member_limit",
    {
      p_organization_id: organizationId,
      p_email: data.email,
      p_role: data.role,
      p_invited_by: data.invited_by,
    }
  );
  if (error) throw error;
  return result ?? null;
}

/**
 * C7: Atomic instance slot reservation — calls a DB function that checks the instance
 * count and inserts the local record in a single operation.
 * Returns null when the limit is already reached (concurrent request won the race).
 * The external Evolution API call must only happen after this succeeds.
 *
 * Production requires the PostgreSQL function `create_instance_if_under_limit`.
 */
export async function createInstanceAtomically(
  client: SupabaseClient,
  organizationId: string,
  data: Pick<EvolutionInstance, "instance_name" | "instance_id" | "webhook_url"> & { status?: string }
): Promise<EvolutionInstance | null> {
  const { data: result, error } = await (client as any).rpc(
    "create_instance_if_under_limit",
    {
      p_organization_id: organizationId,
      p_instance_name: data.instance_name,
      p_instance_id: data.instance_id,
      p_webhook_url: data.webhook_url,
      p_status: data.status ?? "connecting",
    }
  );
  if (error) throw error;
  return result ?? null;
}
