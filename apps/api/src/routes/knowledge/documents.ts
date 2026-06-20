import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { getAdminClient, getDocumentsByAgent, getDocumentById, deleteDocument, getAgentById } from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { fireAudit } from "../../lib/audit";
import { uploadDocument } from "../../services/knowledge.service";
import type { DocumentFileType } from "@aula-agente/shared";

export default async function knowledgeDocumentRoutes(app: FastifyInstance) {
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  app.addHook("preHandler", authMiddleware);

  // List documents for an agent
  app.get<{ Params: { organizationId: string; agentId: string } }>(
    "/organizations/:organizationId/agents/:agentId/documents",
    async (request, reply) => {
      const { organizationId, agentId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId
      );
      if (!membership) return reply.status(403).send({ error: "Acesso negado" });

      const db = getAdminClient();
      const agent = await getAgentById(db, agentId, organizationId);
      if (!agent) return reply.status(404).send({ error: "Agente não encontrado" });

      const documents = await getDocumentsByAgent(db, agentId, organizationId);
      return documents;
    }
  );

  // Upload document
  app.post<{ Params: { organizationId: string; agentId: string } }>(
    "/organizations/:organizationId/agents/:agentId/documents",
    async (request, reply) => {
      const { organizationId, agentId } = request.params;
      const membership = request.user.memberships.find(
        (m) => m.organization_id === organizationId && m.role !== "agent"
      );
      if (!membership) return reply.status(403).send({ error: "Acesso de administrador necessário" });

      const db = getAdminClient();
      const agent = await getAgentById(db, agentId, organizationId);
      if (!agent) return reply.status(404).send({ error: "Agente não encontrado" });

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "Nenhum arquivo enviado" });
      }

      const fileBuffer = await data.toBuffer();
      const fileName = data.filename;
      const ext = fileName.split(".").pop()?.toLowerCase() as DocumentFileType;
      const titleField = data.fields.title as { value?: string } | undefined;
      const title = titleField?.value || fileName;

      const document = await uploadDocument({
        organizationId,
        agentId,
        title,
        fileName,
        fileBuffer,
        fileType: ext,
      });

      fireAudit(db, {
        organization_id: organizationId,
        user_id: request.user.id,
        action: "document.uploaded",
        entity_type: "document",
        entity_id: document.id,
        metadata: { agent_id: agentId, file_name: fileName, file_type: ext },
      }, request.log);

      return reply.status(201).send(document);
    }
  );

  // Delete document
  app.delete<{ Params: { documentId: string } }>(
    "/documents/:documentId",
    async (request, reply) => {
      const db = getAdminClient();

      let doc;
      try {
        doc = await getDocumentById(db, request.params.documentId);
      } catch {
        return reply.status(404).send({ error: "Documento não encontrado" });
      }

      const membership = request.user.memberships.find(
        (m) => m.organization_id === doc.organization_id && m.role !== "agent"
      );
      // Return 404 (not 403) to avoid revealing document existence to unauthorized users
      if (!membership) return reply.status(404).send({ error: "Documento não encontrado" });

      // R9: reject deletion when file is outside the managed bucket — prevents false-success audit
      const bucketPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/knowledge-documents/`;
      if (!doc.file_url.startsWith(bucketPrefix)) {
        request.log.warn(
          { docId: doc.id, file_url: doc.file_url },
          "document.deleted: file_url outside managed bucket, aborting"
        );
        return reply.status(422).send({ error: "Arquivo fora do bucket gerenciado. Contacte o suporte." });
      }

      const storagePath = doc.file_url.slice(bucketPrefix.length);
      const { error: storageError } = await db.storage.from("knowledge-documents").remove([storagePath]);
      if (storageError) {
        request.log.error({ storageError, storagePath }, "Falha ao remover arquivo do storage");
        return reply.status(500).send({ error: "Erro ao remover arquivo do storage" });
      }

      await deleteDocument(db, doc.id, doc.organization_id);

      fireAudit(db, {
        organization_id: doc.organization_id,
        user_id: request.user.id,
        action: "document.deleted",
        entity_type: "document",
        entity_id: doc.id,
        metadata: { agent_id: doc.agent_id },
      }, request.log);

      return reply.status(204).send();
    }
  );
}
