import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";
import { withTimeout } from "../../lib/db-timeout";
import type { Plan, Subscription, BillingEvent } from "@aula-agente/shared";

const QUERY_MS = 8_000;
const EVENTS_MS = 5_000;

export default async function subscriptionRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/subscription", async (request, reply) => {
    const orgId = request.organizationId;
    const userRole = request.userRole;
    const db = getAdminClient();

    // Fire all queries in parallel — worst case is one 8s window, not 29s
    const [subResult, agentsResult, membersResult, instancesResult, eventsResult] =
      await Promise.allSettled([
        withTimeout(
          db.from("subscriptions")
            .select("*, plans(*)")
            .eq("organization_id", orgId)
            .maybeSingle(),
          QUERY_MS,
          "subscription+plan"
        ),
        withTimeout(
          db.from("agents")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", orgId),
          QUERY_MS,
          "agents-count"
        ),
        withTimeout(
          db.from("organization_members")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", orgId),
          QUERY_MS,
          "members-count"
        ),
        withTimeout(
          db.from("evolution_instances")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", orgId),
          QUERY_MS,
          "instances-count"
        ),
        userRole !== "agent"
          ? withTimeout(
              db.from("billing_events")
                .select("id, gateway, event_type, status, created_at")
                .eq("organization_id", orgId)
                .order("created_at", { ascending: false })
                .limit(50),
              EVENTS_MS,
              "billing-events"
            )
          : Promise.resolve({ data: [] as BillingEvent[], error: null }),
      ]);

    // Subscription is the only critical query — fail fast if it died
    if (subResult.status === "rejected") {
      request.log.error({ err: subResult.reason }, "subscription query failed");
      return reply.status(503).send({ error: "Serviço temporariamente indisponível. Tente novamente em instantes." });
    }

    const { data: subData, error: subError } = subResult.value;
    if (subError) {
      request.log.error({ err: subError }, "subscription query returned error");
      return reply.status(500).send({ error: "Failed to fetch subscription" });
    }

    // Unpack the joined plan from the subscription row
    let subscription: Subscription | null = null;
    let plan: Plan | null = null;
    if (subData) {
      const { plans: embeddedPlan, ...subFields } = subData as { plans: Plan | null } & Record<string, unknown>;
      subscription = subFields as unknown as Subscription;
      plan = embeddedPlan ?? null;
    }

    // Usage counts — non-critical, default to 0 on failure
    if (agentsResult.status === "rejected")
      request.log.warn({ err: agentsResult.reason }, "agents count failed");
    if (membersResult.status === "rejected")
      request.log.warn({ err: membersResult.reason }, "members count failed");
    if (instancesResult.status === "rejected")
      request.log.warn({ err: instancesResult.reason }, "instances count failed");

    const usage = {
      agents_used:    agentsResult.status    === "fulfilled" ? (agentsResult.value.count    ?? 0) : 0,
      members_used:   membersResult.status   === "fulfilled" ? (membersResult.value.count   ?? 0) : 0,
      instances_used: instancesResult.status === "fulfilled" ? (instancesResult.value.count ?? 0) : 0,
    };

    // Billing events — non-critical, silent fallback to []
    let recentEvents: BillingEvent[] = [];
    if (eventsResult.status === "fulfilled") {
      const { data: events, error: eventsError } = eventsResult.value;
      if (eventsError) {
        request.log.warn({ err: eventsError }, "billing_events query error — returning []");
      } else {
        recentEvents = (events ?? []) as BillingEvent[];
      }
    } else {
      request.log.warn({ err: eventsResult.reason }, "billing_events timed out — returning []");
    }

    const limits = plan
      ? { max_agents: plan.max_agents, max_members: plan.max_members, max_instances: plan.max_instances }
      : null;

    return reply.send({ subscription, plan, usage, limits, recentEvents });
  });
}
