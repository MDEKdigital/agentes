import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";

export default async function subscriptionRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/subscription", async (request, reply) => {
    const orgId = request.organizationId;
    const userRole = request.userRole;
    const db = getAdminClient();

    // 1. Fetch subscription (maybeSingle — no throw if not found)
    const { data: subscription, error: subError } = await db
      .from("subscriptions")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (subError) {
      request.log.error({ err: subError }, "Failed to fetch subscription");
      return reply.status(500).send({ error: "Failed to fetch subscription" });
    }

    // 2. Fetch plan if subscription exists
    let plan = null;
    if (subscription) {
      const { data: planData, error: planError } = await db
        .from("plans")
        .select("*")
        .eq("id", subscription.plan_id)
        .single();

      if (planError) {
        request.log.error({ err: planError }, "Failed to fetch plan");
        return reply.status(500).send({ error: "Failed to fetch plan" });
      }
      plan = planData;
    }

    // 3. Count usage in parallel
    const [agentsResult, membersResult, instancesResult] = await Promise.all([
      db
        .from("agents")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId),
      db
        .from("organization_members")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId),
      db
        .from("evolution_instances")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId),
    ]);

    const usage = {
      agents_used: agentsResult.count ?? 0,
      members_used: membersResult.count ?? 0,
      instances_used: instancesResult.count ?? 0,
    };

    // 4. Fetch recent billing events (not for "agent" role)
    // Non-fatal: billing history is secondary to subscription info. If the table
    // doesn't exist yet (pending migration) or the query fails, return empty events
    // rather than blocking the whole page with a 500.
    let recentEvents: unknown[] = [];
    if (userRole !== "agent") {
      const { data: events, error: eventsError } = await db
        .from("billing_events")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (eventsError) {
        request.log.warn({ err: eventsError }, "Could not fetch billing events — returning empty list");
      } else {
        recentEvents = events ?? [];
      }
    }

    // 5. Build limits from plan
    const limits = plan
      ? {
          max_agents: plan.max_agents,
          max_members: plan.max_members,
          max_instances: plan.max_instances,
        }
      : null;

    return reply.send({
      subscription,
      plan,
      usage,
      limits,
      recentEvents,
    });
  });
}
