import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchMediaBase64,
  transcribeAudio,
  preprocessAudioMessage,
  preprocessImageMessage,
} from "../process-message";
import type { Message } from "@aula-agente/shared";

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  getInstanceById: vi.fn(),
}));
vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: vi.fn(() => ({ add: vi.fn() })),
}));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_MESSAGE: "process-message" },
}));
vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../../lib/lock", () => ({
  acquireConversationLock: vi.fn(async () => "lock-value"),
  releaseConversationLock: vi.fn(async () => {}),
  renewConversationLock: vi.fn().mockResolvedValue(true),
  LOCK_RENEWAL_INTERVAL_MS: 15_000,
}));
vi.mock("../../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({
    text: "resposta",
    model: "gpt-4o",
    tokensUsed: 10,
    latencyMs: 50,
    toolCalls: [],
  })),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  process.env.EVOLUTION_API_URL = "http://evolution.local";
  process.env.EVOLUTION_API_KEY = "test-evo-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

const audioMessage: Message = {
  id: "msg-1",
  conversation_id: "conv-1",
  organization_id: "org-1",
  evolution_message_id: "EVO123",
  role: "contact",
  content: "[áudio]",
  media_url: null,
  media_type: "audio",
  metadata: null,
  created_at: "2026-06-12T00:00:00Z",
};

const imageMessage: Message = {
  id: "msg-2",
  conversation_id: "conv-1",
  organization_id: "org-1",
  evolution_message_id: "EVO456",
  role: "contact",
  content: "[imagem]",
  media_url: null,
  media_type: "image",
  metadata: null,
  created_at: "2026-06-12T00:00:00Z",
};

describe("fetchMediaBase64", () => {
  it("chama Evolution API e retorna base64 e mimeType", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base64: "dGVzdA==", mimetype: "audio/ogg; codecs=opus" }),
    });

    const result = await fetchMediaBase64(
      "my-instance",
      "5511999@s.whatsapp.net",
      "EVO123",
      "audioMessage"
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://evolution.local/chat/getBase64FromMediaMessage/my-instance",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "test-evo-key" }),
        body: expect.stringContaining("EVO123"),
      })
    );
    expect(result.base64).toBe("dGVzdA==");
    expect(result.mimeType).toBe("audio/ogg; codecs=opus");
  });

  it("lança quando Evolution API retorna status não-ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "not found" });
    await expect(
      fetchMediaBase64("instance", "jid", "id", "audioMessage")
    ).rejects.toThrow("Evolution API error");
  });
});

describe("transcribeAudio", () => {
  it("chama OpenAI Whisper e retorna o texto transcrito", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: "olá, tudo bem?" }),
    });

    const result = await transcribeAudio("dGVzdA==", "audio/ogg", "sk-openai-key");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-openai-key" }),
      })
    );
    expect(result).toBe("olá, tudo bem?");
  });

  it("lança quando Whisper retorna status não-ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "quota exceeded" });
    await expect(transcribeAudio("dGVzdA==", "audio/ogg", "sk-key")).rejects.toThrow();
  });
});

describe("preprocessAudioMessage", () => {
  it("retorna mensagem com transcrição para provider openai", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ base64: "dGVzdA==", mimetype: "audio/ogg" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "mensagem transcrita" }),
      });

    const result = await preprocessAudioMessage(
      audioMessage,
      "my-instance",
      "5511999",
      "openai",
      "sk-key"
    );

    expect(result.message.content).toContain("mensagem transcrita");
    expect(result.message.content).toContain("<audio_transcription>");
    expect(result.failed).toBe(false);
  });

  it("retorna fallback textual para provider não-openai", async () => {
    const result = await preprocessAudioMessage(
      audioMessage,
      "my-instance",
      "5511999",
      "anthropic",
      "sk-ant-key"
    );

    expect(result.message.content).toBe(
      "[Usuário enviou um áudio. Transcrição não disponível para este agente.]"
    );
    expect(result.failed).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retorna fallback de erro quando fetchMediaBase64 falha", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "error" });

    const result = await preprocessAudioMessage(
      audioMessage,
      "my-instance",
      "5511999",
      "openai",
      "sk-key"
    );

    expect(result.message.content).toBe("[Usuário enviou um áudio. Não foi possível processar.]");
    expect(result.failed).toBe(true);
  });

  it("retorna mensagem original se evolution_message_id for null", async () => {
    const msg = { ...audioMessage, evolution_message_id: null };
    const result = await preprocessAudioMessage(msg, "inst", "5511", "openai", "sk");
    expect(result.message).toBe(msg);
    expect(result.failed).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("preprocessImageMessage", () => {
  it("retorna base64 e mimeType da imagem quando fetch tem sucesso", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base64: "imgBase64==", mimetype: "image/jpeg" }),
    });

    const result = await preprocessImageMessage(imageMessage, "my-instance", "5511999");

    expect(result).toEqual({ base64: "imgBase64==", mimeType: "image/jpeg" });
  });

  it("retorna null quando fetchMediaBase64 falha", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "error" });

    const result = await preprocessImageMessage(imageMessage, "my-instance", "5511999");

    expect(result).toBeNull();
  });

  it("retorna null quando evolution_message_id é null", async () => {
    const msg = { ...imageMessage, evolution_message_id: null };
    const result = await preprocessImageMessage(msg, "inst", "5511");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
