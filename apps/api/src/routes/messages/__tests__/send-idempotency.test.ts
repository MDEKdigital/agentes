/**
 * C10 — Idempotência no envio manual de mensagens (POST /messages/send)
 *
 * O cliente pode enviar um idempotency_key opcional.
 * Requisições repetidas com a mesma key devem reutilizar a mensagem existente
 * sem criar novo registro no DB e sem enfileirar segundo envio lógico.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const {
  mockAuthMiddleware,
  mockGetAdminClient,
  mockGetConversationById,
  mockGetInstanceById,
  mockGetMessageByIdempotencyKey,
  mockSaveMessage,
  mockEnqueueSendMessage,
} = vi.hoisted(() => ({
  mockAuthMiddleware: vi.fn(),
  mockGetAdminClient: vi.fn(),
  mockGetConversationById: vi.fn(),
  mockGetInstanceById: vi.fn(),
  mockGetMessageByIdempotencyKey: vi.fn(),
  mockSaveMessage: vi.fn(),
  mockEnqueueSendMessage: vi.fn(),
}));

vi.mock("../../../middleware/auth", () => ({ authMiddleware: mockAuthMiddleware }));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: mockGetAdminClient,
  getConversationById: mockGetConversationById,
  getInstanceById: mockGetInstanceById,
  getMessageByIdempotencyKey: mockGetMessageByIdempotencyKey,
}));

vi.mock("../../../services/message.service", () => ({
  saveMessage: mockSaveMessage,
}));

vi.mock("../../../lib/queue", () => ({
  enqueueSendMessage: mockEnqueueSendMessage,
}));

import messageSendRoutes from "../send";

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CONV_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const INST_ID = "aaaaaaaa-0000-0000-0000-000000000003";
const MSG_ID  = "aaaaaaaa-0000-0000-0000-000000000004";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000005";

const IDEM_KEY = "client-idem-key-abc123";

const INSTANCE_FIXTURE = {
  id: INST_ID,
  organization_id: ORG_ID,
  instance_name: "wa-test",
  status: "connected",
};

const CONVERSATION_FIXTURE = {
  id: CONV_ID,
  organization_id: ORG_ID,
  evolution_instance_id: INST_ID,
  contacts: { phone: "5511999999999" },
};

const EXISTING_MSG = {
  id: MSG_ID,
  conversation_id: CONV_ID,
  organization_id: ORG_ID,
  role: "human_agent",
  content: "olá",
  metadata: { idempotency_key: IDEM_KEY },
};

function makeDb() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { organization_id: ORG_ID },
            error: null,
          }),
        }),
      }),
    }),
  };
}

async function buildApp() {
  mockAuthMiddleware.mockImplementation(async (request: any) => {
    request.user = { id: USER_ID, memberships: [{ organization_id: ORG_ID, role: "agent" }] };
  });
  const app = Fastify({ logger: false });
  await app.register(messageSendRoutes);
  return app;
}

async function sendWith(app: Awaited<ReturnType<typeof buildApp>>, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/messages/send",
    payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminClient.mockReturnValue(makeDb());
  mockGetConversationById.mockResolvedValue(CONVERSATION_FIXTURE);
  mockGetInstanceById.mockResolvedValue(INSTANCE_FIXTURE);
  mockGetMessageByIdempotencyKey.mockResolvedValue(null); // no existing by default
  mockSaveMessage.mockResolvedValue({ id: MSG_ID });
  mockEnqueueSendMessage.mockResolvedValue(undefined);
});

// ── testes C10 ────────────────────────────────────────────────────────────────

describe("C10 — idempotência no envio manual (POST /messages/send)", () => {

  // 1. Fluxo normal com key nova
  it("envio com idempotency_key nova: cria mensagem e enfileira normalmente → 200", async () => {
    const app = await buildApp();
    const res = await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    });

    // Current code: schema doesn't accept idempotency_key → 400 or ignored → RED
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, messageId: MSG_ID });
    expect(mockSaveMessage).toHaveBeenCalledOnce();
    expect(mockEnqueueSendMessage).toHaveBeenCalledOnce();
  });

  // 2. Retry com mesma key NÃO cria segunda mensagem
  it("retry com mesma idempotency_key: NÃO chama saveMessage de novo", async () => {
    mockGetMessageByIdempotencyKey.mockResolvedValue(EXISTING_MSG);

    const app = await buildApp();
    const res = await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    });

    expect(res.statusCode).toBe(200);
    // Current code: no guard → saveMessage IS called → FAIL → RED
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  // 3. Retry retorna o messageId da mensagem existente
  it("retry com mesma idempotency_key: retorna messageId da mensagem existente", async () => {
    mockGetMessageByIdempotencyKey.mockResolvedValue(EXISTING_MSG);

    const app = await buildApp();
    const res = await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    });

    expect(res.json()).toMatchObject({ ok: true, messageId: MSG_ID });
  });

  // 4. Retry ainda enfileira com jobId estável (garante entrega se enqueue anterior falhou)
  it("retry com mesma idempotency_key: enfileira com jobId estável derivado da key", async () => {
    mockGetMessageByIdempotencyKey.mockResolvedValue(EXISTING_MSG);

    const app = await buildApp();
    await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    });

    // Current code: no stable jobId in enqueueSendMessage → FAIL → RED
    expect(mockEnqueueSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: MSG_ID }),
      expect.objectContaining({ jobId: `idem_${IDEM_KEY}` })
    );
  });

  // 5. Primeira vez (nova key): enqueueSendMessage também usa jobId estável
  it("primeiro envio com idempotency_key: enqueueSendMessage usa jobId estável", async () => {
    const app = await buildApp();
    await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    });

    // Current code: no jobId → FAIL → RED
    expect(mockEnqueueSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: MSG_ID }),
      expect.objectContaining({ jobId: `idem_${IDEM_KEY}` })
    );
  });

  // 6. idempotency_key é persistida no metadata da mensagem
  it("idempotency_key é passada ao saveMessage como metadata", async () => {
    const app = await buildApp();
    await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    });

    // Current code: metadata not set → FAIL → RED
    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ idempotency_key: IDEM_KEY }),
      })
    );
  });

  // 7. Falha em enqueue após persistência: retry com mesma key não cria nova mensagem
  it("falha em enqueue: retry com mesma key reutiliza mensagem persistida", async () => {
    // First call: saveMessage OK, but enqueueSendMessage fails → message exists in DB
    mockEnqueueSendMessage.mockRejectedValueOnce(new Error("Redis unavailable"));
    mockGetMessageByIdempotencyKey.mockResolvedValueOnce(null); // first call: no existing

    const app = await buildApp();
    // First request (fails at enqueue)
    await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    }).catch(() => {}); // may throw or return 500

    // Second request (retry): existing message is now in DB
    mockGetMessageByIdempotencyKey.mockResolvedValue(EXISTING_MSG);
    mockEnqueueSendMessage.mockResolvedValue(undefined);

    const res = await sendWith(app, {
      conversation_id: CONV_ID,
      content: "olá",
      idempotency_key: IDEM_KEY,
    });

    expect(res.statusCode).toBe(200);
    // saveMessage called only once (first request), not on retry
    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
  });

  // 8. Duas requisições com keys diferentes: tratadas independentemente
  it("duas keys diferentes: saveMessage chamado para cada uma (sem interferência)", async () => {
    const app = await buildApp();

    await sendWith(app, {
      conversation_id: CONV_ID,
      content: "primeira",
      idempotency_key: "key-A",
    });
    await sendWith(app, {
      conversation_id: CONV_ID,
      content: "segunda",
      idempotency_key: "key-B",
    });

    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
  });

  // 9. Envio SEM idempotency_key: compatibilidade retroativa
  it("envio sem idempotency_key: funciona normalmente, sem chamar getMessageByIdempotencyKey", async () => {
    const app = await buildApp();
    const res = await sendWith(app, {
      conversation_id: CONV_ID,
      content: "sem key",
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetMessageByIdempotencyKey).not.toHaveBeenCalled();
    expect(mockSaveMessage).toHaveBeenCalledOnce();
  });

  // 10. Roles continuam funcionando
  it("admin envia com idempotency_key → 200", async () => {
    mockAuthMiddleware.mockImplementation(async (request: any) => {
      request.user = {
        id: "admin-id",
        memberships: [{ organization_id: ORG_ID, role: "admin" }],
      };
    });
    const app = Fastify({ logger: false });
    await app.register(messageSendRoutes);

    const res = await sendWith(app, {
      conversation_id: CONV_ID,
      content: "admin msg",
      idempotency_key: "admin-key-1",
    });

    expect(res.statusCode).toBe(200);
  });
});
