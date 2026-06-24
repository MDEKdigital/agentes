import type { FastifyInstance } from "fastify";
import type { Plan } from "@aula-agente/shared";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware, requireOrg } from "../../middleware/auth";
import { QUERY_MS } from "../../lib/db-timeout";

export default async function plansRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", requireOrg);

  app.get("/billing/plans", async (request, reply) => {
    if (request.userRole === "agent") {
      return reply.status(403).send({ error: "Acesso restrito a administradores." });
    }
    const db = getAdminClient();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), QUERY_MS);
    try {
      const { data, error } = await db
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .abortSignal(ctrl.signal);
      if (error) throw error;
      return reply.send(data as Plan[]);
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isTimeout = isAbort || (err instanceof Error && err.message.includes("timeout"));
      request.log.error({ err }, "[billing/plans] query failed");
      return reply
        .status(isTimeout ? 503 : 500)
        .send({ error: isTimeout ? "Serviço temporariamente indisponível." : "Failed to fetch plans" });
    } finally {
      clearTimeout(timer);
    }
  });
}
