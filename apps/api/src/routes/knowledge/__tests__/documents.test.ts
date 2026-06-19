import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetAgentById,
  mockGetDocumentById,
  mockDeleteDocument,
  mockUploadDocument,
  mockCreateAuditLog,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetAgentById: vi.fn(),
  mockGetDocumentById: vi.fn(),
  mockDeleteDocument: vi.fn(),
  mockUploadDocument: vi.fn(),
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddleware,
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getAgentById: mockGetAgentById,
  getDocumentsByAgent: vi.fn().mockResolvedValue([]),
  getDocumentById: mockGetDocumentById,
  deleteDocument: mockDeleteDocument,
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../../../services/knowledge.service", () => ({
  uploadDocument: mockUploadDocument,
}));

import knowledgeDocumentRoutes from "../documents";

const ORG_ID = "org-uuid-1";
const AGENT_ID = "agent-uuid-1";
const DOC_ID = "doc-uuid-1";
const USER_ID = "user-uuid-1";

const mockAgent = { id: AGENT_ID, organization_id: ORG_ID, name: "Agente Teste" };
const mockDocument = {
  id: DOC_ID,
  agent_id: AGENT_ID,
  organization_id: ORG_ID,
  title: "test.txt",
  file_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/knowledge-documents/test.txt`,
  file_type: "txt",
  created_at: "2026-01-01T00:00:00Z",
};

function makeStorageDb() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  };
}

async function buildApp(role = "admin") {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role }] };
  });
  const app = Fastify({ logger: false });
  await app.register(knowledgeDocumentRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeStorageDb());
  mockGetAgentById.mockResolvedValue(mockAgent);
  mockGetDocumentById.mockResolvedValue(mockDocument);
  mockDeleteDocument.mockResolvedValue(undefined);
  mockCreateAuditLog.mockResolvedValue({});
  mockUploadDocument.mockResolvedValue({ ...mockDocument, id: DOC_ID });
});

describe("Audit logs — documents", () => {
  it("document.uploaded é auditado ao fazer upload de documento", async () => {
    const boundary = "---testboundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      "Content-Type: text/plain",
      "",
      "conteúdo do arquivo de teste",
      `--${boundary}--`,
    ].join("\r\n");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${ORG_ID}/agents/${AGENT_ID}/documents`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "document.uploaded",
        entity_type: "document",
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });

  it("document.deleted é auditado ao deletar documento", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/documents/${DOC_ID}`,
    });
    expect(res.statusCode).toBe(204);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "document.deleted",
        entity_type: "document",
        entity_id: DOC_ID,
        organization_id: ORG_ID,
        user_id: USER_ID,
      })
    );
  });
});
