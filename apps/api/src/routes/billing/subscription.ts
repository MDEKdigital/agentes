import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";
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

    request.log.info({ orgId, userRole }, "billing/subscription: handler reached");

    // AbortController cancels the actual HTTP fetch inside Supabase client.
    // setTimeout-based races don't work when the underlying socket hangs —
    // the fetch promise never settles and the Promise.allSettled waits forever.
    const ctrl = new AbortController();
    const evCtrl = new AbortController();
    const ctrlTimer = setTimeout(() => {
      request.log.warn("billing/subscription: ABORT TIMER FIRED — aborting DB queries");
      ctrl.abort();
    }, QUERY_MS);
    const evTimer = setTimeout(() => evCtrl.abort(), EVENTS_MS);

    request.log.info("billing/subscription: starting allSettled");

    const [subResult, agentsResult, membersResult, instancesResult, eventsResult] =
      await Promise.allSettled([
        db.from("subscriptions")
          .select("*, plans(*)")
          .eq("organization_id", orgId)
          .abortSignal(ctrl.signal)
          .maybeSingle(),
        db.from("agents")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .abortSignal(ctrl.signal),
        db.from("organization_members")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .abortSignal(ctrl.signal),
        db.from("evolution_instances")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .abortSignal(ctrl.signal),
        userRole !== "agent"
          ? db.from("billing_events")
              .select("id, gateway, event_type, status, created_at")
              .eq("organization_id", orgId)
              .order("created_at", { ascending: false })
              .limit(50)
              .abortSignal(evCtrl.signal)
          : Promise.resolve({ data: [] as BillingEvent[], error: null }),
      ]);

    clearTimeout(ctrlTimer);
    clearTimeout(evTimer);

    request.log.info({
      sub: subResult.status,
      agents: agentsResult.status,
      members: membersResult.status,
      instances: instancesResult.status,
      events: eventsResult.status,
    }, "billing/subscription: allSettled resolved");

    // Subscription is the only critical query — fail fast if it timed out or errored
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
