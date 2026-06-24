import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";
import type { Plan, Subscription, BillingEvent } from "@aula-agente/shared";

const QUERY_MS  = 8_000;
const EVENTS_MS = 5_000;

type PlanLimits = Pick<Plan, "max_agents" | "max_members" | "max_instances">;

// Creates a one-shot AbortSignal that fires after `ms` milliseconds.
// Uses setTimeout so the timer is visible to the Node.js event loop
// AND the fetch-level timeout in getAdminClient() acts as a safety net.
function makeSignal(ms: number): [AbortSignal, () => void] {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return [ctrl.signal, () => clearTimeout(id)];
}

export default async function subscriptionRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/subscription", async (request, reply) => {
    const orgId = request.organizationId;
    const userRole = request.userRole;

    if (userRole === "agent") {
      return reply.status(403).send({ error: "Acesso restrito a administradores." });
    }

    const db = getAdminClient();

    // Each query gets its own AbortController so they can be cancelled
    // independently. The fetch-level timeout in getAdminClient() (15 s) acts
    // as a second safety net in case the socket stalls at a lower layer.
    const [subSig,   clearSub]   = makeSignal(QUERY_MS);
    const [agSig,    clearAg]    = makeSignal(QUERY_MS);
    const [memSig,   clearMem]   = makeSignal(QUERY_MS);
    const [instSig,  clearInst]  = makeSignal(QUERY_MS);
    const [evSig,    clearEv]    = makeSignal(EVENTS_MS);

    const [subResult, agentsResult, membersResult, instancesResult, eventsResult] =
      await Promise.allSettled([
        db.from("subscriptions")
          .select("*, plans(*)")
          .eq("organization_id", orgId)
          .abortSignal(subSig)
          .maybeSingle(),
        db.from("agents")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .abortSignal(agSig),
        db.from("organization_members")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .abortSignal(memSig),
        db.from("evolution_instances")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .abortSignal(instSig),
        db.from("billing_events")
          .select("id, gateway, event_type, status, created_at")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(50)
          .abortSignal(evSig),
      ]);

    clearSub(); clearAg(); clearMem(); clearInst(); clearEv();

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

    // Unpack the joined plan from the subscription row.
    // Supabase may return plans as Plan[] when the FK relation is not recognised as unique.
    let subscription: Subscription | null = null;
    let plan: Plan | null = null;
    if (subData) {
      const { plans: rawPlan, ...subFields } = subData as { plans: Plan | Plan[] | null } & Subscription;
      subscription = subFields as Subscription;
      plan = Array.isArray(rawPlan) ? ((rawPlan[0] as Plan) ?? null) : (rawPlan as Plan | null) ?? null;
      if (subscription && !plan) {
        request.log.warn({ plan_id: (subscription as Subscription & { plan_id?: string }).plan_id },
          "subscription references a plan that was not found in the join — data integrity issue");
      }
    }

    // Usage counts — non-critical, default to 0 on failure or DB error
    if (agentsResult.status === "rejected")
      request.log.warn({ err: agentsResult.reason }, "agents count failed");
    else if (agentsResult.value.error)
      request.log.warn({ err: agentsResult.value.error }, "agents count returned error");

    if (membersResult.status === "rejected")
      request.log.warn({ err: membersResult.reason }, "members count failed");
    else if (membersResult.value.error)
      request.log.warn({ err: membersResult.value.error }, "members count returned error");

    if (instancesResult.status === "rejected")
      request.log.warn({ err: instancesResult.reason }, "instances count failed");
    else if (instancesResult.value.error)
      request.log.warn({ err: instancesResult.value.error }, "instances count returned error");

    const usage = {
      agents_used:    agentsResult.status    === "fulfilled" && !agentsResult.value.error    ? (agentsResult.value.count    ?? 0) : 0,
      members_used:   membersResult.status   === "fulfilled" && !membersResult.value.error   ? (membersResult.value.count   ?? 0) : 0,
      instances_used: instancesResult.status === "fulfilled" && !instancesResult.value.error ? (instancesResult.value.count ?? 0) : 0,
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

    const limits: PlanLimits | null = plan
      ? { max_agents: plan.max_agents, max_members: plan.max_members, max_instances: plan.max_instances }
      : null;

    return reply.send({ subscription, plan, usage, limits, recentEvents });
  });
}
