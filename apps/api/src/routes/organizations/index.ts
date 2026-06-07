import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { deleteInstance } from "../../services/evolution.service";

export default async function organizationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.delete<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId",
    async (request, reply) => {
      const { organizationId } = request.params;

      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role === "owner"
      );
      if (!membership) {
        return reply.status(403).send({ error: "Apenas proprietários podem excluir a organização" });
      }

      const db = getAdminClient();

      // Delete instances from Evolution API before removing from DB
      const { data: instances } = await db
        .from("evolution_instances")
        .select("instance_name")
        .eq("organization_id", organizationId);

      if (instances && instances.length > 0) {
        await Promise.allSettled(
          instances.map((inst) => deleteInstance(inst.instance_name))
        );
      }

      const { error } = await db.from("organizations").delete().eq("id", organizationId);
      if (error) {
        request.log.error({ error }, "Falha ao excluir organização");
        return reply.status(500).send({ error: "Erro ao excluir organização" });
      }

      return reply.status(204).send();
    }
  );
}
