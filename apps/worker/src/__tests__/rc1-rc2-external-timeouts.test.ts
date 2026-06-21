/**
 * RED tests for RC-1 and RC-2:
 * - RC-1: Evolution API calls must carry an explicit AbortSignal timeout
 * - RC-2: Whisper transcription and LLM generateText must not hang indefinitely
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks needed for modules that import workers / DB ────────────────────────

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
  QUEUE_NAMES: { PROCESS_MESSAGE: "process-message", SEND_MESSAGE: "send-message" },
}));
vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../lib/lock", () => ({
  acquireConversationLock: vi.fn(async () => "lock-value"),
  releaseConversationLock: vi.fn(async () => {}),
  renewConversationLock: vi.fn().mockResolvedValue(true),
  LOCK_RENEWAL_INTERVAL_MS: 15_000,
}));
vi.mock("../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../lib/media-validation", () => ({
  validateMediaPayload: vi.fn(),
}));
vi.mock("../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({
    text: "resposta",
    model: "gpt-4o",
    tokensUsed: 10,
    latencyMs: 50,
    toolCalls: [],
  })),
}));
vi.mock("../workers/evaluate-activation", () => ({
  evaluateActivation: vi.fn(async () => ({ action: "ignore" })),
}));
vi.mock("../agents/tools/close-conversation", () => ({
  CLOSE_CONVERSATION_TOOL_NAME: "close_conversation",
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { evolutionPost, evolutionPostJson, EVOLUTION_TIMEOUT_MS } from "../lib/evolution";
import { transcribeAudio, WHISPER_TIMEOUT_MS } from "../workers/process-message";
import { withTimeout, LLM_TIMEOUT_MS, VALIDATION_TIMEOUT_MS } from "../lib/with-timeout";

// ── Shared mock fetch ────────────────────────────────────────────────────────

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

// ════════════════════════════════════════════════════════════════════════════
// RC-1: Evolution API — timeout explícito
// ════════════════════════════════════════════════════════════════════════════

describe("RC-1: evolutionPost e evolutionPostJson — AbortSignal.timeout", () => {
  it("EVOLUTION_TIMEOUT_MS é exportado e positivo", () => {
    expect(EVOLUTION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("EVOLUTION_TIMEOUT_MS é menor que 5 minutos (razoável para chamadas HTTP)", () => {
    expect(EVOLUTION_TIMEOUT_MS).toBeLessThan(5 * 60 * 1000);
  });

  it("evolutionPost passa AbortSignal para o fetch", async () => {
    const abortTimeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { cancel: vi.fn() },
    });

    await evolutionPost("/message/sendText/instance", { number: "551199", text: "Olá" });

    expect(abortTimeoutSpy).toHaveBeenCalled();
    expect(abortTimeoutSpy).toHaveBeenCalledWith(EVOLUTION_TIMEOUT_MS);
  });

  it("evolutionPostJson passa AbortSignal para o fetch", async () => {
    const abortTimeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base64: "dGVzdA==", mimetype: "audio/ogg" }),
    });

    await evolutionPostJson("/chat/getBase64FromMediaMessage/instance", { message: {} });

    expect(abortTimeoutSpy).toHaveBeenCalled();
    expect(abortTimeoutSpy).toHaveBeenCalledWith(EVOLUTION_TIMEOUT_MS);
  });

  it("AbortError de fetch propagado corretamente (não swallowed)", async () => {
    const abortError = new DOMException("This operation was aborted", "AbortError");
    mockFetch.mockRejectedValue(abortError);

    await expect(evolutionPost("/test", {})).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fluxo nominal de evolutionPost continua funcionando", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { cancel: vi.fn() },
    });

    await expect(
      evolutionPost("/message/sendText/inst", { number: "55119", text: "ok" })
    ).resolves.toBeUndefined();
  });

  it("fluxo nominal de evolutionPostJson retorna parsed JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base64: "abc==", mimetype: "audio/ogg" }),
    });

    const result = await evolutionPostJson<{ base64: string; mimetype: string }>(
      "/chat/getBase64FromMediaMessage/inst",
      {}
    );

    expect(result.base64).toBe("abc==");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-2a: Whisper / transcribeAudio — timeout explícito
// ════════════════════════════════════════════════════════════════════════════

describe("RC-2a: transcribeAudio — AbortSignal.timeout", () => {
  it("WHISPER_TIMEOUT_MS é exportado e positivo", () => {
    expect(WHISPER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("WHISPER_TIMEOUT_MS é >= EVOLUTION_TIMEOUT_MS (áudio pode ser maior)", () => {
    expect(WHISPER_TIMEOUT_MS).toBeGreaterThanOrEqual(EVOLUTION_TIMEOUT_MS);
  });

  it("transcribeAudio passa AbortSignal para o fetch do Whisper", async () => {
    const abortTimeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: "Olá mundo" }),
    });

    await transcribeAudio("dGVzdA==", "audio/ogg", "sk-test");

    expect(abortTimeoutSpy).toHaveBeenCalled();
    expect(abortTimeoutSpy).toHaveBeenCalledWith(WHISPER_TIMEOUT_MS);
  });

  it("AbortError de Whisper propagado (não swallowed em transcribeAudio)", async () => {
    const abortError = new DOMException("This operation was aborted", "AbortError");
    mockFetch.mockRejectedValue(abortError);

    await expect(transcribeAudio("dGVzdA==", "audio/ogg", "sk-test")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fluxo nominal de transcribeAudio continua funcionando", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: "Olá mundo" }),
    });

    const result = await transcribeAudio("dGVzdA==", "audio/ogg", "sk-test");
    expect(result).toBe("Olá mundo");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-2b: LLM generateText — withTimeout wrapper
// ════════════════════════════════════════════════════════════════════════════

describe("RC-2b: withTimeout — utilitário de timeout para chamadas LLM", () => {
  it("LLM_TIMEOUT_MS é exportado e razoável", () => {
    expect(LLM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LLM_TIMEOUT_MS).toBeLessThan(10 * 60 * 1000); // < 10 minutos
  });

  it("VALIDATION_TIMEOUT_MS é exportado e menor que LLM_TIMEOUT_MS", () => {
    expect(VALIDATION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(VALIDATION_TIMEOUT_MS).toBeLessThanOrEqual(LLM_TIMEOUT_MS);
  });

  it("withTimeout resolve normalmente quando a promise resolve antes do timeout", async () => {
    const result = await withTimeout(Promise.resolve("resultado"), 5000);
    expect(result).toBe("resultado");
  });

  it("withTimeout rejeita com mensagem de timeout quando a promise não resolve", async () => {
    const neverResolves = new Promise<string>(() => {});
    await expect(withTimeout(neverResolves, 50)).rejects.toThrow(/timed out/i);
  }, 5000);

  it("withTimeout propaga rejeição normal da promise (não mascara)", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("erro de negócio")), 5000)
    ).rejects.toThrow("erro de negócio");
  });

  it("withTimeout rejeita com duração incluída na mensagem", async () => {
    const neverResolves = new Promise<string>(() => {});
    await expect(withTimeout(neverResolves, 50)).rejects.toThrow("50ms");
  }, 5000);
});
