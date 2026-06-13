import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getInstanceByInstanceId: vi.fn(),
  getAgentById: vi.fn(),
}));
vi.mock("../../../services/conversation.service", () => ({
  ensureConversation: vi.fn(),
}));
vi.mock("../../../services/message.service", () => ({
  saveMessage: vi.fn(),
}));
vi.mock("../../../lib/queue", () => ({
  enqueueProcessMessage: vi.fn(),
}));
vi.mock("../../../middleware/webhook-verify", () => ({
  webhookVerifyMiddleware: vi.fn(async () => {}),
}));

import { getInstanceByInstanceId, getAgentById } from "@aula-agente/database";
import { ensureConversation } from "../../../services/conversation.service";
import { saveMessage } from "../../../services/message.service";
import { enqueueProcessMessage } from "../../../lib/queue";
import evolutionWebhookRoutes from "../evolution";

const validPayload = {
  event: "messages.upsert",
  instance: "inst-abc",
  data: {
    key: { fromMe: false, id: "evo-msg-1", remoteJid: "5511999999999@s.whatsapp.net" },
    pushName: "João",
    messageType: "conversation",
    message: { conversation: "Olá!" },
  },
};

const activeInstance = {
  id: "inst-db-1",
  organization_id: "org-1",
  active_agent_id: "agent-1",
  instance_name: "inst-abc",
};

async function buildApp() {
  const app = Fastify();
  await app.register(evolutionWebhookRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAgentById).mockResolvedValue({ activation_keywords: [] } as never);
});

describe("POST /webhooks/evolution", () => {
  it("retorna 200 skipped quando fromMe=true", async () => {
    const app = await buildApp();
    const payload = { ...validPayload, data: { ...validPayload.data, key: { ...validPayload.data.key, fromMe: true } } };

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("fromMe");
  });

  it("retorna 200 skipped quando instância não existe (PGRST116)", async () => {
    vi.mocked(getInstanceByInstanceId).mockRejectedValue({ code: "PGRST116" });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("unknown_instance");
  });

  it("retorna 200 skipped quando instância não tem agente ativo", async () => {
    vi.mocked(getInstanceByInstanceId).mockResolvedValue({ ...activeInstance, active_agent_id: null } as never);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("no_agent");
  });

  it("retorna 200 skipped quando human takeover está ativo", async () => {
    vi.mocked(getInstanceByInstanceId).mockResolvedValue(activeInstance as never);
    vi.mocked(ensureConversation).mockResolvedValue({ conversation: { id: "conv-1", is_human_takeover: true } } as never);
    vi.mocked(saveMessage).mockResolvedValue({ id: "msg-1" } as never);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("human_takeover");
    expect(enqueueProcessMessage).not.toHaveBeenCalled();
  });

  it("caminho feliz: 200 com messageId e job enfileirado", async () => {
    vi.mocked(getInstanceByInstanceId).mockResolvedValue(activeInstance as never);
    vi.mocked(ensureConversation).mockResolvedValue({ conversation: { id: "conv-1", is_human_takeover: false } } as never);
    vi.mocked(saveMessage).mockResolvedValue({ id: "msg-saved-1" } as never);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/webhooks/evolution", payload: validPayload });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe("msg-saved-1");
    expect(enqueueProcessMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", agentId: "agent-1" })
    );
  });
});

import { extractMessageContent } from "../evolution";

describe("extractMessageContent", () => {
  it("extrai url de audioMessage", () => {
    const data = {
      messageType: "audioMessage",
      message: { audioMessage: { url: "https://cdn.example.com/audio.ogg" } },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.content).toBe("[áudio]");
    expect(result.mediaType).toBe("audio");
    expect(result.mediaUrl).toBe("https://cdn.example.com/audio.ogg");
  });

  it("extrai url e caption de imageMessage", () => {
    const data = {
      messageType: "imageMessage",
      message: {
        imageMessage: { url: "https://cdn.example.com/photo.jpg", caption: "olha isso" },
      },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.content).toBe("olha isso");
    expect(result.mediaType).toBe("image");
    expect(result.mediaUrl).toBe("https://cdn.example.com/photo.jpg");
  });

  it("retorna mediaUrl null para mensagem de texto", () => {
    const data = {
      messageType: "conversation",
      message: { conversation: "oi" },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.mediaUrl).toBeNull();
  });

  it("retorna mediaUrl null quando audioMessage não tem url", () => {
    const data = {
      messageType: "audioMessage",
      message: { audioMessage: {} },
    };
    const result = extractMessageContent(data as Record<string, unknown>);
    expect(result.mediaUrl).toBeNull();
  });
});
