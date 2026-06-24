import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";
import type { Plan, Subscription, BillingEvent } from "@aula-agente/shared";

// Hard limit: if the route handler hasn't sent a response in this many ms,
// forcibly send 503. This works even when fetch hangs at the TCP level because
// setTimeout fires on the event loop regardless of pending awaits.
const HARD_TIMEOUT_MS = 11_000;

type PlanLimits = Pick<Plan, "max_agents" | "max_members" | "max_instances">;

export default async function subscriptionRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/subscription", async (request, reply) => {
    const orgId = request.organizationId;
    const userRole = request.userRole;

    if (userRole === "agent") {
      return reply.status(403).send({ error: "Acesso restrito a administradores." });
    }

    // Forcibly send 503 if the queries haven't all resolved by HARD_TIMEOUT_MS.
    const hardTimer = setTimeout(() => {
      if (!reply.sent) {
        request.log.error("[billing/subscription] hard timeout — forcing 503");
        void reply.status(503).send({ error: "Serviço temporariamente indisponível. Tente novamente em instantes." });
      }
    }, HARD_TIMEOUT_MS);

    const db = getAdminClient();

    const [subResult, agentsResult, membersResult, instancesResult, eventsResult] =
      await Promise.allSettled([
        db.from("subscriptions").select("*, plans(*)").eq("organization_id", orgId).maybeSingle(),
        db.from("agents").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        db.from("organization_members").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        db.from("evolution_instances").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        db.from("billing_events").select("id, gateway, event_type, status, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(50),
      ]);

    if (reply.sent) return; // hard timeout already responded
    clearTimeout(hardTimer);

    if (subResult.status === "rejected") {
      request.log.error({ err: subResult.reason }, "subscription query failed");
      return reply.status(503).send({ error: "Serviço temporariamente indisponível. Tente novamente em instantes." });
    }

    const { data: subData, error: subError } = subResult.value;
    if (subError) {
      request.log.error({ err: subError }, "subscription query returned error");
      return reply.status(500).send({ error: "Failed to fetch subscription" });
    }

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
