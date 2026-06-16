import type { FastifyInstance } from "fastify";
import { getAdminClient, getActivePlans } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

export default async function plansRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get("/billing/plans", async (request, reply) => {
    const db = getAdminClient();
    try {
      const plans = await getActivePlans(db);
      return reply.send(plans);
    } catch (err) {
      request.log.error({ err }, "Failed to fetch plans");
      return reply.status(500).send({ error: "Failed to fetch plans" });
    }
  });
}
