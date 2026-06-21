/**
 * RED tests for OB-7: preprocessAudioMessage and preprocessImageMessage use bare
 * console.warn (no structured fields) when media fetch/transcription fails.
 *
 * Problem:
 *   Both functions catch errors and return a "failed" degradation result, but log
 *   with console.warn — no messageId, no conversationId, no organizationId.
 *   When audio/image processing silently degrades in production (user gets placeholder
 *   content instead of transcription/image analysis), there's no structured trace
 *   to correlate WHICH conversation was affected.
 *
 * Fix:
 *   Replace console.warn with workerLog("process-message", "warn",
 *   { messageId: message.id, conversationId: message.conversation_id,
 *     organizationId: message.organization_id }, msg)
 *   in both catch blocks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockWorkerLog } = vi.hoisted(() => ({
  mockWorkerLog: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({ workerLog: mockWorkerLog }));
vi.mock("../lib/metrics", () => ({ incrementMetric: vi.fn() }));
vi.mock("../lib/dead-letter", () => ({ enqueueDeadLetter: vi.fn() }));

// Evolution mock — injected per-test
const mockEvolutionPostJson = vi.fn();
vi.mock("../lib/evolution", () => ({
  evolutionPost: vi.fn(),
  evolutionPostJson: (...args: unknown[]) => mockEvolutionPostJson(...args),
  EVOLUTION_TIMEOUT_MS: 30_000,
}));

vi.mock("../lib/media-validation", () => ({
  validateMediaPayload: vi.fn(), // no-op by default
}));

// Whisper fetch mock
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_MESSAGE: "process-message", SEND_MESSAGE: "send-message" },
}));
vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  setConversationWaiting: vi.fn(),
  getInstanceById: vi.fn(),
}));
vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: vi.fn(() => ({ add: vi.fn() })),
  getConnectionOptions: vi.fn(() => ({})),
}));
vi.mock("../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../lib/lock", () => ({
  acquireConversationLock: vi.fn(async () => "v"),
  releaseConversationLock: vi.fn(),
  renewConversationLock: vi.fn().mockResolvedValue(true),
  LOCK_RENEWAL_INTERVAL_MS: 15_000,
  LockContentionError: class LockContentionError extends Error {},
}));
vi.mock("../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({ text: "ok", model: "gpt-4o", tokensUsed: 0, latencyMs: 0, toolCalls: [] })),
}));
vi.mock("../workers/evaluate-activation", () => ({
  evaluateActivation: vi.fn(async () => ({ action: "activate" })),
}));
vi.mock("../agents/tools/close-conversation", () => ({
  CLOSE_CONVERSATION_TOOL_NAME: "close_conversation",
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { preprocessAudioMessage, preprocessImageMessage } from "../workers/process-message";
import type { Message } from "@aula-agente/shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MESSAGE_ID = "msg-001";
const CONV_ID = "conv-001";
const ORG_ID = "org-001";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: MESSAGE_ID,
    conversation_id: CONV_ID,
    organization_id: ORG_ID,
    evolution_message_id: "evo-msg-001",
    role: "contact",
    content: "Olá",
    media_url: null,
    media_type: "audio",
    metadata: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Default: evolutionPostJson fails (simulates Evolution API error)
  mockEvolutionPostJson.mockRejectedValue(new Error("Evolution API error 500: internal error"));
});

// ════════════════════════════════════════════════════════════════════════════
// OB-7A — preprocessAudioMessage catch: workerLog com campos estruturados
// ════════════════════════════════════════════════════════════════════════════

describe("OB-7A: preprocessAudioMessage — workerLog no catch block", () => {
  it("chama workerLog('process-message', 'warn', ...) quando fetchMediaBase64 falha", async () => {
    const message = makeMessage({ media_type: "audio" });

    await preprocessAudioMessage(message, "instance-001", "+5511999999999", "openai", "sk-test");

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "process-message",
      "warn",
      expect.objectContaining({ messageId: MESSAGE_ID }),
      expect.stringMatching(/audio|falha|preprocessing/i)
    );
  });

  it("contexto inclui conversationId quando audio processing falha", async () => {
    const message = makeMessage({ media_type: "audio" });

    await preprocessAudioMessage(message, "instance-001", "+5511999999999", "openai", "sk-test");

    const warnCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-message" && level === "warn"
    );
    expect(warnCall).toBeDefined();
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.conversationId).toBe(CONV_ID);
  });

  it("contexto inclui organizationId quando audio processing falha", async () => {
    const message = makeMessage({ media_type: "audio" });

    await preprocessAudioMessage(message, "instance-001", "+5511999999999", "openai", "sk-test");

    const warnCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-message" && level === "warn"
    );
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.organizationId).toBe(ORG_ID);
  });

  it("contexto inclui messageId quando audio processing falha", async () => {
    const message = makeMessage({ media_type: "audio" });

    await preprocessAudioMessage(message, "instance-001", "+5511999999999", "openai", "sk-test");

    const warnCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-message" && level === "warn"
    );
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.messageId).toBe(MESSAGE_ID);
  });

  it("retorna { failed: true } mesmo quando workerLog é chamado (degradação graciosa)", async () => {
    const message = makeMessage({ media_type: "audio" });

    const result = await preprocessAudioMessage(
      message, "instance-001", "+5511999999999", "openai", "sk-test"
    );

    expect(result.failed).toBe(true);
  });

  it("NOT chama workerLog quando evolution_message_id é null (skip silencioso esperado)", async () => {
    const message = makeMessage({ evolution_message_id: null });

    await preprocessAudioMessage(message, "instance-001", "+5511999999999", "openai", "sk-test");

    expect(mockWorkerLog).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-7B — preprocessImageMessage catch: workerLog com campos estruturados
// ════════════════════════════════════════════════════════════════════════════

describe("OB-7B: preprocessImageMessage — workerLog no catch block", () => {
  it("chama workerLog('process-message', 'warn', ...) quando fetchMediaBase64 falha", async () => {
    const message = makeMessage({ media_type: "image" });

    await preprocessImageMessage(message, "instance-001", "+5511999999999");

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "process-message",
      "warn",
      expect.objectContaining({ messageId: MESSAGE_ID }),
      expect.stringMatching(/image|imagem|falha|fetch/i)
    );
  });

  it("contexto inclui conversationId quando image fetch falha", async () => {
    const message = makeMessage({ media_type: "image" });

    await preprocessImageMessage(message, "instance-001", "+5511999999999");

    const warnCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-message" && level === "warn"
    );
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.conversationId).toBe(CONV_ID);
  });

  it("contexto inclui organizationId quando image fetch falha", async () => {
    const message = makeMessage({ media_type: "image" });

    await preprocessImageMessage(message, "instance-001", "+5511999999999");

    const warnCall = mockWorkerLog.mock.calls.find(
      ([worker, level]) => worker === "process-message" && level === "warn"
    );
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.organizationId).toBe(ORG_ID);
  });

  it("retorna null em vez de lançar quando image fetch falha (degradação graciosa)", async () => {
    const message = makeMessage({ media_type: "image" });

    const result = await preprocessImageMessage(message, "instance-001", "+5511999999999");

    expect(result).toBeNull();
  });
});
