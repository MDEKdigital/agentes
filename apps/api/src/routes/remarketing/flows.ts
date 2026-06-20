import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { fireAudit } from "../../lib/audit";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function remarketingFlowRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // V9: reject malformed org header before membership check
  app.addHook("preHandler", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string | undefined;
    if (orgId && !UUID_RE.test(orgId)) {
      return reply.status(400).send({ error: "x-organization-id deve ser um UUID valido" });
    }
  });

  app.get("/remarketing/flows", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    if (!orgId) return reply.status(400).send({ error: "x-organization-id obrigatório" });

    const membership = request.user.memberships.find((m) => m.organization_id === orgId);
    if (!membership) return reply.status(403).send({ error: "Acesso negado" });

    const db = getAdminClient();
    const { data, error } = await db
      .from("remarketing_flows")
      .select("*, remarketing_steps(count)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) return reply.status(500).send({ error: "Erro ao listar fluxos" });
    return reply.send(data);
  });

  app.post<{
    Body: {
      name: string;
      product_campaign: string;
      agent_id: string;
      instance_id: string;
      entry_silence_minutes: number;
      cancel_on_reply?: boolean;
      cancel_on_resolved?: boolean;
      cancel_on_opt_out?: boolean;
      system_prompt?: string;
    };
  }>("/remarketing/flows", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    if (!orgId) return reply.status(400).send({ error: "x-organization-id obrigatório" });

    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const { name, product_campaign, agent_id, instance_id, entry_silence_minutes,
            cancel_on_reply = true, cancel_on_resolved = true, cancel_on_opt_out = true,
            system_prompt = "" } = request.body;

    const db = getAdminClient();

    const { data: agent } = await db
      .from("agents")
      .select("id")
      .eq("id", agent_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!agent) return reply.status(403).send({ error: "Agente não pertence a esta organização" });

    const { data: instance } = await db
      .from("evolution_instances")
      .select("id")
      .eq("id", instance_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!instance) return reply.status(403).send({ error: "Instância não pertence a esta organização" });

    const { data, error } = await db
      .from("remarketing_flows")
      .insert({ organization_id: orgId, name, product_campaign, agent_id, instance_id,
                entry_silence_minutes, cancel_on_reply, cancel_on_resolved, cancel_on_opt_out,
                system_prompt })
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao criar fluxo" });

    fireAudit(db, {
      organization_id: orgId,
      user_id: request.user.id,
      action: "remarketing_flow.created",
      entity_type: "remarketing_flow",
      entity_id: data.id,
      metadata: { name: data.name },
    }, request.log);

    return reply.status(201).send(data);
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      product_campaign?: string;
      agent_id?: string;
      instance_id?: string;
      entry_silence_minutes?: number;
      cancel_on_reply?: boolean;
      cancel_on_resolved?: boolean;
      cancel_on_opt_out?: boolean;
      system_prompt?: string;
    };
  }>("/remarketing/flows/:id", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const { data: flow } = await db
      .from("remarketing_flows")
      .select("id")
      .eq("id", request.params.id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    const { name, product_campaign, agent_id, instance_id, entry_silence_minutes,
            cancel_on_reply, cancel_on_resolved, cancel_on_opt_out, system_prompt } = request.body;
    const updates = Object.fromEntries(
      Object.entries({ name, product_campaign, agent_id, instance_id, entry_silence_minutes,
                       cancel_on_reply, cancel_on_resolved, cancel_on_opt_out, system_prompt })
        .filter(([, v]) => v !== undefined)
    );

    if (updates.agent_id) {
      const { data: agent } = await db.from("agents").select("id")
        .eq("id", updates.agent_id).eq("organization_id", orgId).maybeSingle();
      if (!agent) return reply.status(403).send({ error: "Agente não pertence a esta organização" });
    }
    if (updates.instance_id) {
      const { data: instance } = await db.from("evolution_instances").select("id")
        .eq("id", updates.instance_id).eq("organization_id", orgId).maybeSingle();
      if (!instance) return reply.status(403).send({ error: "Instância não pertence a esta organização" });
    }

    const { data, error } = await db
      .from("remarketing_flows")
      .update(updates)
      .eq("id", request.params.id)
      .eq("organization_id", orgId)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: "Erro ao atualizar fluxo" });

    fireAudit(db, {
      organization_id: orgId,
      user_id: request.user.id,
      action: "remarketing_flow.updated",
      entity_type: "remarketing_flow",
      entity_id: request.params.id,
    }, request.log);

    return reply.send(data);
  });

  app.delete<{ Params: { id: string } }>("/remarketing/flows/:id", async (request, reply) => {
    const orgId = request.headers["x-organization-id"] as string;
    const membership = request.user.memberships.find(
      (m) => m.organization_id === orgId && m.role !== "agent"
    );
    if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

    const db = getAdminClient();
    const { data: flow } = await db
      .from("remarketing_flows")
      .select("id")
      .eq("id", request.params.id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    const { count } = await db
      .from("remarketing_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("flow_id", request.params.id)
      .eq("status", "active");

    if (count && count > 0) {
      return reply.status(409).send({
        error: "Existem conversas em andamento neste fluxo. Desative o fluxo primeiro para cancelar os enrollments ativos, depois exclua.",
      });
    }

    const { error } = await db
      .from("remarketing_flows")
      .delete()
      .eq("id", request.params.id)
      .eq("organization_id", orgId);

    if (error) return reply.status(500).send({ error: "Erro ao deletar fluxo" });

    fireAudit(db, {
      organization_id: orgId,
      user_id: request.user.id,
      action: "remarketing_flow.deleted",
      entity_type: "remarketing_flow",
      entity_id: request.params.id,
    }, request.log);

    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/remarketing/flows/:id/duplicate",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const { data: original } = await db
        .from("remarketing_flows")
        .select("*, remarketing_steps(*)")
        .eq("id", request.params.id)
        .eq("organization_id", orgId)
        .single();

      if (!original) return reply.status(404).send({ error: "Fluxo não encontrado" });

      const { id, created_at, updated_at, last_executed_at, remarketing_steps, ...flowData } = original;

      const { data: newFlow, error: flowErr } = await db
        .from("remarketing_flows")
        .insert({ ...flowData, name: `${flowData.name} (cópia)`, status: "inactive" })
        .select()
        .single();

      if (flowErr) return reply.status(500).send({ error: "Erro ao duplicar fluxo" });

      if (remarketing_steps && remarketing_steps.length > 0) {
        const steps = remarketing_steps.map(({ id: _id, flow_id: _fid, created_at: _ca, ...step }: Record<string, unknown>) => ({
          ...step,
          flow_id: newFlow.id,
        }));
        const { error: stepsErr } = await db.from("remarketing_steps").insert(steps);
        if (stepsErr) return reply.status(500).send({ error: "Erro ao duplicar etapas" });
      }

      fireAudit(db, {
        organization_id: orgId,
        user_id: request.user.id,
        action: "remarketing_flow.duplicated",
        entity_type: "remarketing_flow",
        entity_id: newFlow.id,
        metadata: { original_id: request.params.id },
      }, request.log);

      return reply.status(201).send(newFlow);
    }
  );

  app.patch<{ Params: { id: string }; Body: { status: "active" | "inactive" } }>(
    "/remarketing/flows/:id/status",
    async (request, reply) => {
      const orgId = request.headers["x-organization-id"] as string;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === orgId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const { status } = request.body;
      if (!["active", "inactive"].includes(status)) {
        return reply.status(400).send({ error: "Status inválido" });
      }

      const db = getAdminClient();
      const { data: flow } = await db
        .from("remarketing_flows")
        .select("id")
        .eq("id", request.params.id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

      if (status === "inactive") {
        await db
          .from("remarketing_enrollments")
          .update({ status: "cancelled", cancel_reason: "flow_deactivated" })
          .eq("flow_id", request.params.id)
          .eq("status", "active");
      }

      const { data, error } = await db
        .from("remarketing_flows")
        .update({ status })
        .eq("id", request.params.id)
        .eq("organization_id", orgId)
        .select()
        .single();

      if (error) return reply.status(500).send({ error: "Erro ao atualizar status" });

      fireAudit(db, {
        organization_id: orgId,
        user_id: request.user.id,
        action: "remarketing_flow.status_changed",
        entity_type: "remarketing_flow",
        entity_id: request.params.id,
        metadata: { status },
      }, request.log);

      return reply.send(data);
    }
  );
}
