import type { FastifyInstance } from "fastify";
import { getAdminClient, getActivePlans } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

export default async function plansRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get("/billing/plans", async (_request, reply) => {
    const db = getAdminClient();
    const plans = await getActivePlans(db);
    return reply.send(plans);
  });
}
