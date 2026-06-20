/**
 * V7 — Send: POLÍTICA A (agent pode enviar mensagem manual em qualquer conversa da org)
 *
 * POST /messages/send verifica apenas membership (qualquer membro da org).
 * Não há restrição de role. Agents podem enviar em qualquer conversa,
 * inclusive em conversas atribuídas a outros agents — comportamento intencional.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetConversationById,
  mockGetInstanceById,
  mockSaveMessage,
  mockEnqueueSendMessage,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetConversationById: vi.fn(),
  mockGetInstanceById: vi.fn(),
  mockSaveMessage: vi.fn(),
  mockEnqueueSendMessage: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getConversationById: mockGetConversationById,
  getInstanceById: mockGetInstanceById,
}));

vi.mock("../../../services/message.service", () => ({
  saveMessage: mockSaveMessage,
}));

vi.mock("../../../lib/queue", () => ({
  enqueueSendMessage: mockEnqueueSendMessage,
}));

import messageSendRoutes from "../send";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const CONV_ID = "00000000-0000-0000-0000-000000000002";
const INST_ID = "00000000-0000-0000-0000-000000000003";
const AGENT_A = "00000000-0000-0000-0000-000000000004";
const AGENT_B = "00000000-0000-0000-0000-000000000005";
const ADMIN_ID = "00000000-0000-0000-0000-000000000006";
const OWNER_ID = "00000000-0000-0000-0000-000000000007";
const MSG_ID = "00000000-0000-0000-0000-000000000008";

const INSTANCE_FIXTURE = {
  id: INST_ID,
  organization_id: ORG_ID,
  instance_name: "wa-test",
  status: "connected",
};

function makeConversation(assignedTo: string | null) {
  return {
    id: CONV_ID,
    organization_id: ORG_ID,
    evolution_instance_id: INST_ID,
    assigned_to: assignedTo,
    contacts: { phone: "5511999999999" },
  };
}

function makeDb(assignedTo: string | null = null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { organization_id: ORG_ID, assigned_to: assignedTo },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function buildApp(role: "agent" | "admin" | "owner", userId: string) {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: userId, memberships: [{ organization_id: ORG_ID, role }] };
  });
  const app = Fastify({ logger: false });
  return app.register(messageSendRoutes).then(() => app);
}

async function sendMsg(app: Awaited<ReturnType<typeof buildApp>>) {
  return app.inject({
    method: "POST",
    url: "/messages/send",
    payload: { conversation_id: CONV_ID, content: "olá" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb(null));
  mockGetConversationById.mockResolvedValue(makeConversation(null));
  mockGetInstanceById.mockResolvedValue(INSTANCE_FIXTURE);
  mockSaveMessage.mockResolvedValue({ id: MSG_ID });
  mockEnqueueSendMessage.mockResolvedValue(undefined);
});

describe("V7 — Send: POLÍTICA A (agent acessa qualquer conversa da org)", () => {
  it("agent envia mensagem em conversa atribuída a si mesmo → 200", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(AGENT_A));
    mockGetConversationById.mockResolvedValue(makeConversation(AGENT_A));
    const app = await buildApp("agent", AGENT_A);
    const res = await sendMsg(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, messageId: MSG_ID });
  });

  it("agent envia mensagem em conversa SEM assigned_to → 200", async () => {
    const app = await buildApp("agent", AGENT_A);
    const res = await sendMsg(app);
    expect(res.statusCode).toBe(200);
  });

  it("agent envia mensagem em conversa atribuída a OUTRO agent → 200 (POLÍTICA A)", async () => {
    mockGetAdminClient.mockReturnValue(makeDb(AGENT_B));
    mockGetConversationById.mockResolvedValue(makeConversation(AGENT_B));
    const app = await buildApp("agent", AGENT_A);
    const res = await sendMsg(app);
    expect(res.statusCode).toBe(200);
  });

  it("admin envia mensagem → 200", async () => {
    const app = await buildApp("admin", ADMIN_ID);
    const res = await sendMsg(app);
    expect(res.statusCode).toBe(200);
  });

  it("owner envia mensagem → 200", async () => {
    const app = await buildApp("owner", OWNER_ID);
    const res = await sendMsg(app);
    expect(res.statusCode).toBe(200);
  });
});
