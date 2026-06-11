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
  fetchInstanceDetails,
  updateProfileName,
  updateProfileStatus,
  updateProfilePicture,
  getInstanceSettings,
  setInstanceSettings,
  getPrivacySettings,
  updatePrivacySettings,
  restartInstance,
  requestPairingCode,
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

      try {
        const db = getAdminClient();
        const instances = await getInstancesByOrganization(db, organizationId);
        return instances;
      } catch (err) {
        request.log.error({ err }, "Failed to list instances");
        return reply.status(500).send({ error: "Erro ao listar instâncias" });
      }
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

      const [status, details] = await Promise.all([
        getInstanceStatus(instance.instance_name) as Promise<Record<string, Record<string, string>>>,
        fetchInstanceDetails(instance.instance_name),
      ]);

      const newStatus = status?.instance?.state === "open" ? "connected" as const : "disconnected" as const;
      const ownerJid = details?.ownerJid as string | undefined;
      const phoneNumber = ownerJid ? ownerJid.replace(/@.*$/, "") : instance.phone_number;

      // Sync status and phone_number to DB
      if (newStatus !== instance.status || (phoneNumber && instance.phone_number !== phoneNumber)) {
        await updateInstance(db, instance.id, {
          status: newStatus,
          phone_number: phoneNumber || instance.phone_number,
        });
      }

      return { ...instance, status: newStatus, phone_number: phoneNumber || instance.phone_number, live: status };
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

      if (instance.status !== "connected") {
        return { name: null, status: null, picture: null };
      }

      try {
        const details = await fetchInstanceDetails(instance.instance_name);
        const ownerJid = details?.ownerJid as string | undefined;
        const phoneNumber = ownerJid
          ? ownerJid.replace(/@.*$/, "")
          : instance.phone_number;

        if (!phoneNumber) return { name: null, status: null, picture: null };

        // Persist phone_number if not set yet
        if (!instance.phone_number && phoneNumber) {
          await updateInstance(db, instance.id, { phone_number: phoneNumber });
        }

        let bioText: string | null = null;
        try {
          const profileData = await fetchProfile(instance.instance_name, phoneNumber) as Record<string, unknown>;
          const statusField = profileData?.status as Record<string, string> | string | undefined;
          bioText =
            (typeof statusField === "object" ? statusField?.status : statusField) ||
            (profileData?.description as string) ||
            null;
          if (bioText?.trim() === "") bioText = null;
        } catch {
          // bio is optional — proceed without it
        }

        return {
          name: (details?.profileName as string) ?? null,
          status: bioText,
          picture: (details?.profilePicUrl as string) ?? null,
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

  // Get instance settings
  app.get<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/settings",
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
      const membership = request.user.memberships.find((m) => m.organization_id === instance.organization_id);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });
      try {
        const settings = await getInstanceSettings(instance.instance_name);
        return settings;
      } catch {
        return {};
      }
    }
  );

  // Update instance settings
  app.post<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/settings",
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
      await setInstanceSettings(instance.instance_name, request.body as Record<string, unknown>);
      return { ok: true };
    }
  );

  // Get privacy settings
  app.get<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/privacy",
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
      const membership = request.user.memberships.find((m) => m.organization_id === instance.organization_id);
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });
      if (instance.status !== "connected") return reply.status(422).send({ error: "Instância não está conectada" });
      try {
        const privacy = await getPrivacySettings(instance.instance_name);
        return privacy;
      } catch {
        return {};
      }
    }
  );

  // Update privacy settings
  app.put<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/privacy",
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
      if (instance.status !== "connected") return reply.status(422).send({ error: "Instância não está conectada" });
      await updatePrivacySettings(instance.instance_name, request.body as Record<string, unknown>);
      return { ok: true };
    }
  );

  // Restart instance
  app.post<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/restart",
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
        await restartInstance(instance.instance_name);
      } catch (err) {
        request.log.warn({ err }, "restartInstance failed on Evolution API");
      }
      return { ok: true };
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

  // Request pairing code (connect via phone number)
  app.post<{ Params: { instanceId: string } }>(
    "/instances/:instanceId/pairing-code",
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

      const body = request.body as { phone_number?: unknown };
      const phone = String(body?.phone_number ?? "");

      if (!/^\d{10,11}$/.test(phone)) {
        return reply.status(400).send({ error: "Número inválido. Informe DDD + número (10 ou 11 dígitos, apenas números)" });
      }

      const fullNumber = `55${phone}`;
      const result = await requestPairingCode(instance.instance_name, fullNumber) as { code: string };
      return { code: result.code };
    }
  );
}
