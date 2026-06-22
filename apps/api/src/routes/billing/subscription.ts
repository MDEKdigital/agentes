import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";

// Races a PromiseLike (e.g. Supabase query builder) against a deadline.
// If the deadline fires first, rejects with a timeout error.
// Does NOT cancel the underlying query — it lets the handler move on
// so the response isn't held hostage by a slow DB call.
function race<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`DB timeout: ${label}`)), ms);
    void Promise.resolve(p).then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); }
    );
  });
}

export default async function subscriptionRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/subscription", async (request, reply) => {
    const orgId = request.organizationId;
    const userRole = request.userRole;
    const db = getAdminClient();

    // 1. Fetch subscription (maybeSingle — no throw if not found)
    const { data: subscription, error: subError } = await race(
      db.from("subscriptions").select("*").eq("organization_id", orgId).maybeSingle(),
      8_000,
      "subscriptions"
    );

    if (subError) {
      request.log.error({ err: subError }, "Failed to fetch subscription");
      return reply.status(500).send({ error: "Failed to fetch subscription" });
    }

    // 2. Fetch plan if subscription exists
    let plan = null;
    if (subscription) {
      const { data: planData, error: planError } = await race(
        db.from("plans").select("*").eq("id", subscription.plan_id).single(),
        8_000,
        "plans"
      );

      if (planError) {
        request.log.error({ err: planError }, "Failed to fetch plan");
        return reply.status(500).send({ error: "Failed to fetch plan" });
      }
      plan = planData;
    }

    // 3. Count usage in parallel
    const [agentsResult, membersResult, instancesResult] = await race(
      Promise.all([
        db.from("agents").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        db.from("organization_members").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        db.from("evolution_instances").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
      ]),
      8_000,
      "usage-counts"
    );

    const usage = {
      agents_used: agentsResult.count ?? 0,
      members_used: membersResult.count ?? 0,
      instances_used: instancesResult.count ?? 0,
    };

    // 4. Fetch recent billing events (not for "agent" role)
    // Non-fatal + hard 5s deadline: billing history is secondary. If the query
    // errors OR hangs, return empty events rather than blocking the page.
    let recentEvents: unknown[] = [];
    if (userRole !== "agent") {
      try {
        const { data: events, error: eventsError } = await race(
          db
            .from("billing_events")
            .select("*")
            .eq("organization_id", orgId)
            .order("created_at", { ascending: false })
            .limit(50),
          5_000,
          "billing_events"
        );

        if (eventsError) {
          request.log.warn({ err: eventsError }, "Could not fetch billing events — returning empty list");
        } else {
          recentEvents = events ?? [];
        }
      } catch (err) {
        request.log.warn({ err }, "billing_events query timed out or failed — returning empty list");
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
