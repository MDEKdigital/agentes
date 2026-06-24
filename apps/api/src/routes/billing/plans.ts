import type { FastifyInstance } from "fastify";
import type { Plan } from "@aula-agente/shared";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";

// Hard limit: if the route handler hasn't sent a response in this many ms,
// forcibly send 503. This works even when fetch hangs at the TCP level because
// setTimeout fires on the event loop regardless of pending awaits.
const HARD_TIMEOUT_MS = 9_000;

export default async function plansRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/plans", async (request, reply) => {
    if (request.userRole === "agent") {
      return reply.status(403).send({ error: "Acesso restrito a administradores." });
    }

    // Forcibly send 503 if the query hasn't responded by HARD_TIMEOUT_MS.
    // Calling reply.send() from a setTimeout callback sends the HTTP response
    // even while the route handler's async function is still suspended on await.
    const hardTimer = setTimeout(() => {
      if (!reply.sent) {
        request.log.error("[billing/plans] hard timeout — forcing 503");
        void reply.status(503).send({ error: "Serviço temporariamente indisponível." });
      }
    }, HARD_TIMEOUT_MS);

    const db = getAdminClient();
    try {
      const { data, error } = await db
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (reply.sent) return; // hard timeout already responded
      clearTimeout(hardTimer);

      if (error) throw error;
      return reply.send(data as Plan[]);
    } catch (err: unknown) {
      clearTimeout(hardTimer);
      if (reply.sent) return;
      request.log.error({ err }, "[billing/plans] query failed");
      return reply.status(500).send({ error: "Failed to fetch plans" });
    }
  });
}
