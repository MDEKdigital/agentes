import type { FastifyInstance } from "fastify";
import { getAdminClient, getActivePlans } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";
import { withTimeout, TimeoutError, QUERY_MS } from "../../lib/db-timeout";

export default async function plansRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/plans", async (request, reply) => {
    if (request.userRole === "agent") {
      return reply.status(403).send({ error: "Acesso restrito a administradores." });
    }
    const db = getAdminClient();
    try {
      const plans = await withTimeout(getActivePlans(db), QUERY_MS, "plans");
      return reply.send(plans);
    } catch (err) {
      request.log.error({ err }, "Failed to fetch plans");
      const isTimeout = err instanceof TimeoutError;
      return reply
        .status(isTimeout ? 503 : 500)
        .send({ error: isTimeout ? "Serviço temporariamente indisponível." : "Failed to fetch plans" });
    }
  });
}
