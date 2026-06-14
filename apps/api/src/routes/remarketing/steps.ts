import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";

async function resolveFlow(
  db: ReturnType<typeof getAdminClient>,
  flowId: string,
  orgId: string
) {
  const { data } = await db
    .from("remarketing_flows")
    .select("id")
    .eq("id", flowId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data;
}

async function resolveStep(
  db: ReturnType<typeof getAdminClient>,
  stepId: string,
  flowId: string
) {
  const { data } = await db
    .from("remarketing_steps")
    .select("id")
    .eq("id", stepId)
    .eq("flow_id", flowId)
    .maybeSingle();
  return data;
}

export default async function remarketingStepRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get<{ Params: { id: string } }>(
    "/remarketing/flows/:id/steps",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find((m) => m.organization_id === orgId);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const flow = await resolveFlow(db, request.params.id, orgId);
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const { data, error } = await db
        .from("remarketing_steps")
        .select("*")
        .eq("flow_id", request.params.id)
        .order("step_order", { ascending: true });

      if (error) return reply.status(500).send({ error: "Erro ao listar etapas" });
      return reply.send(data);
    }
  );

  app.post<{
    Params: { id: string };
    Body: { step_order: number; wait_minutes: number; message_type: string; message_content: string };
  }>("/remarketing/flows/:id/steps", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const flow = await resolveFlow(db, request.params.id, orgId);
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    const { step_order, wait_minutes, message_type, message_content } = request.body;
    const { data, error } = await db
      .from("remarketing_steps")
      .insert({ flow_id: request.params.id, step_order, wait_minutes, message_type, message_content })
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao criar etapa" });
    return reply.status(201).send(data);
  });

  app.put<{
    Params: { id: string; stepId: string };
    Body: { step_order?: number; wait_minutes?: number; message_type?: string; message_content?: string; is_active?: boolean };
  }>("/remarketing/flows/:id/steps/:stepId", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const flow = await resolveFlow(db, request.params.id, orgId);
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    const step = await resolveStep(db, request.params.stepId, request.params.id);
    if (!step) return reply.status(404).send({ error: "Etapa não encontrada" });

    const { step_order, wait_minutes, message_type, message_content, is_active } = request.body;
    const safeUpdate = Object.fromEntries(
      Object.entries({ step_order, wait_minutes, message_type, message_content, is_active })
        .filter(([, v]) => v !== undefined)
    );
    const { data, error } = await db
      .from("remarketing_steps")
      .update(safeUpdate)
      .eq("id", request.params.stepId)
      .eq("flow_id", request.params.id)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao atualizar etapa" });
    return reply.send(data);
  });

  app.delete<{ Params: { id: string; stepId: string } }>(
    "/remarketing/flows/:id/steps/:stepId",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const flow = await resolveFlow(db, request.params.id, orgId);
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const step = await resolveStep(db, request.params.stepId, request.params.id);
      if (!step) return reply.status(404).send({ error: "Etapa não encontrada" });

      const { error } = await db
        .from("remarketing_steps")
        .delete()
        .eq("id", request.params.stepId)
        .eq("flow_id", request.params.id);

      if (error) return reply.status(500).send({ error: "Erro ao deletar etapa" });
      return reply.status(204).send();
    }
  );

  app.patch<{ Params: { id: string; stepId: string }; Body: { is_active: boolean } }>(
    "/remarketing/flows/:id/steps/:stepId/status",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const flow = await resolveFlow(db, request.params.id, orgId);
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const step = await resolveStep(db, request.params.stepId, request.params.id);
      if (!step) return reply.status(404).send({ error: "Etapa não encontrada" });

      const { data, error } = await db
        .from("remarketing_steps")
        .update({ is_active: request.body.is_active })
        .eq("id", request.params.stepId)
        .eq("flow_id", request.params.id)
        .select()
        .single();

      if (error) return reply.status(500).send({ error: "Erro ao atualizar etapa" });
      return reply.send(data);
    }
  );
}
