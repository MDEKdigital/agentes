import type { FastifyInstance } from "fastify";
import { createInstanceSchema, updateInstanceSchema, updateProfileSchema } from "@aula-agente/shared";
import { getAdminClient } from "@aula-agente/database";
import {
  getInstancesByOrganization,
  getInstanceById,
  createInstance as createInstanceRecord,
  updateInstance,
  deleteInstance as deleteInstanceRecord,
} from "@aula-agente/database";
import {
  createInstance as createEvolutionInstance,
  getInstanceStatus,
  getInstanceQrCode,
  deleteInstance as deleteEvolutionInstance,
  logoutInstance,
  fetchProfile,
  updateProfileName,
  updateProfileStatus,
  updateProfilePicture,
} from "../../services/evolution.service";
import { authMiddleware } from "../../middleware/auth";

export default async function instanceRoutes(app: FastifyInstance) {
  // All routes require auth
  app.addHook("preHandler", authMiddleware);

  // List instances for an organization
  app.get<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/instances",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const instances = await getInstancesByOrganization(db, organizationId);
      return instances;
    }
  );

  // Create instance
  app.post<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/instances",
    async (request, reply) => {
      const { organizationId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const parseResult = createInstanceSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }

      const { instance_name } = parseResult.data;
      const webhookUrl = `${process.env.PUBLIC_API_URL}/webhooks/evolution`;

      // Create in Evolution API
      const evolutionResult = await createEvolutionInstance(instance_name, webhookUrl) as Record<string, Record<string, string>>;

      // Save to database
      const db = getAdminClient();
      const instance = await createInstanceRecord(db, {
        organization_id: organizationId,
        instance_name,
        instance_id: evolutionResult.instance?.instanceName || instance_name,
        webhook_url: webhookUrl,
      });

      return reply.status(201).send(instance);
    }
  );

  // Get instance status
  app.get<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/status",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const status = await getInstanceStatus(instance.instance_name) as Record<string, Record<string, string>>;

      // Sync status to DB
      const newStatus = status?.instance?.state === "open" ? "connected" as const : "disconnected" as const;
      if (newStatus !== instance.status) {
        await updateInstance(db, instance.id, {
          status: newStatus,
          phone_number: status?.instance?.phoneNumber || instance.phone_number,
        });
      }

      return { ...instance, status: newStatus, live: status };
    }
  );

  // Get WhatsApp profile
  app.get<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/profile",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      if (!instance.phone_number || instance.status !== "connected") {
        return { name: null, status: null, picture: null };
      }

      try {
        const profile = await fetchProfile(instance.instance_name, instance.phone_number) as Record<string, string>;
        return {
          name: profile.name ?? null,
          status: profile.status ?? null,
          picture: profile.picture ?? null,
        };
      } catch (err) {
        request.log.warn({ err }, "fetchProfile failed — returning empty profile");
        return { name: null, status: null, picture: null };
      }
    }
  );

  // Update WhatsApp profile
  app.patch<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/profile",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      if (instance.status !== "connected") {
        return reply.status(422).send({ error: "Instância não está conectada" });
      }

      const parseResult = updateProfileSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }

      const body = parseResult.data;
      const tasks: Promise<unknown>[] = [];

      if (body.name !== undefined) {
        tasks.push(updateProfileName(instance.instance_name, body.name));
      }
      if (body.status !== undefined) {
        tasks.push(updateProfileStatus(instance.instance_name, body.status));
      }
      if (body.picture !== undefined) {
        tasks.push(updateProfilePicture(instance.instance_name, body.picture));
      }

      if (tasks.length === 0) {
        return reply.status(400).send({ error: "Nenhum campo para atualizar" });
      }

      const results = await Promise.allSettled(tasks);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        return reply.status(500).send({ error: "Erro ao atualizar um ou mais campos do perfil na Evolution API" });
      }

      return { ok: true };
    }
  );

  // Get QR code
  app.get<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/qrcode",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const qrData = await getInstanceQrCode(instance.instance_name);
      return qrData;
    }
  );

  // Update instance (assign agent)
  app.patch<{ Params: { instanceId: string } }>(
    "/instances/:instanceId",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const parseResult = updateInstanceSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: parseResult.error.issues });
      }

      const updated = await updateInstance(db, instance.id, parseResult.data);
      return updated;
    }
  );

  // Delete instance
  app.delete<{ Params: { instanceId: string } }>(
    "/instances/:instanceId",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id && m.role === "owner"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de proprietário necessário" });

      // Delete from Evolution API
      try {
        await deleteEvolutionInstance(instance.instance_name);
      } catch (err) {
        request.log.warn({ err }, "Failed to delete instance from Evolution API");
      }

      await deleteInstanceRecord(db, instance.id);
      return reply.status(204).send();
    }
  );

  // Logout instance
  app.post<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/logout",
    async (request, reply) => {
      const db = getAdminClient();
      let instance;
      try {
        instance = await getInstanceById(db, request.params.instanceId);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "PGRST116") return reply.status(404).send({ error: "Instância não encontrada" });
        throw err;
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === instance.organization_id && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      try {
        await logoutInstance(instance.instance_name);
      } catch (err) {
        request.log.warn({ err }, "logoutInstance failed on Evolution API");
      }
      await updateInstance(db, instance.id, { status: "disconnected" });

      return { ok: true };
    }
  );
}
