/**
 * RED tests for DL-3:
 * - process-message terminal failure must send a safe fallback to the user.
 * - Covers: isTerminalFailure, handleTerminalFailure, FALLBACK_MESSAGE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockQueueAdd } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
}));

const { mockGetConversationById } = vi.hoisted(() => ({
  mockGetConversationById: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: mockGetConversationById,
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  setConversationWaiting: vi.fn(),
  getInstanceById: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: vi.fn(() => ({ add: mockQueueAdd })),
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
vi.mock("../lib/audit", () => ({ fireAudit: vi.fn() }));
vi.mock("../lib/media-validation", () => ({ validateMediaPayload: vi.fn() }));
vi.mock("../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({ text: "ok", model: "gpt-4o", tokensUsed: 10, latencyMs: 50, toolCalls: [] })),
}));
vi.mock("../workers/evaluate-activation", () => ({
  evaluateActivation: vi.fn(async () => ({ action: "ignore" })),
}));
vi.mock("../agents/tools/close-conversation", () => ({
  CLOSE_CONVERSATION_TOOL_NAME: "close_conversation",
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  isTerminalFailure,
  handleTerminalFailure,
  FALLBACK_MESSAGE,
} from "../workers/process-message";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const jobData = {
  conversationId: "conv-1",
  messageId: "msg-1",
  agentId: "agent-1",
  organizationId: "org-1",
};

const mockConversation = {
  id: "conv-1",
  organization_id: "org-1",
  evolution_instance_id: "inst-1",
  contacts: { phone: "5511999999999" },
  is_human_takeover: false,
  status: "open",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConversationById.mockResolvedValue(mockConversation);
});

// ════════════════════════════════════════════════════════════════════════════
// isTerminalFailure
// ════════════════════════════════════════════════════════════════════════════

describe("DL-3: isTerminalFailure — distingue retry intermediário de falha terminal", () => {
  it("retorna false quando ainda há tentativas restantes (attempt 1 de 3)", () => {
    expect(isTerminalFailure({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
  });

  it("retorna false para segunda tentativa de 3", () => {
    expect(isTerminalFailure({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(false);
  });

  it("retorna true na última tentativa (attempt 3 de 3)", () => {
    expect(isTerminalFailure({ attemptsMade: 3, opts: { attempts: 3 } })).toBe(true);
  });

  it("retorna true quando tentativas excedidas (attempts ausente → default 1)", () => {
    expect(isTerminalFailure({ attemptsMade: 1, opts: {} })).toBe(true);
  });

  it("retorna true quando job.opts não existe (fallback seguro)", () => {
    expect(isTerminalFailure({ attemptsMade: 1 })).toBe(true);
  });

  it("retry intermediário NÃO é terminal (9 sobre 10)", () => {
    expect(isTerminalFailure({ attemptsMade: 9, opts: { attempts: 10 } })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FALLBACK_MESSAGE
// ════════════════════════════════════════════════════════════════════════════

describe("DL-3: FALLBACK_MESSAGE — conteúdo seguro e neutro", () => {
  it("FALLBACK_MESSAGE é uma string não vazia", () => {
    expect(typeof FALLBACK_MESSAGE).toBe("string");
    expect(FALLBACK_MESSAGE.length).toBeGreaterThan(0);
  });

  it("não contém nome de provider (openai, anthropic, google)", () => {
    const lower = FALLBACK_MESSAGE.toLowerCase();
    expect(lower).not.toContain("openai");
    expect(lower).not.toContain("anthropic");
    expect(lower).not.toContain("google");
  });

  it("não contém termos técnicos de infra (redis, bullmq, queue, stack)", () => {
    const lower = FALLBACK_MESSAGE.toLowerCase();
    expect(lower).not.toContain("redis");
    expect(lower).not.toContain("bullmq");
    expect(lower).not.toContain("stack");
    expect(lower).not.toContain("queue");
  });

  it("não contém URL, endereço IP ou chave de API", () => {
    expect(FALLBACK_MESSAGE).not.toMatch(/https?:\/\//);
    expect(FALLBACK_MESSAGE).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(FALLBACK_MESSAGE).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// handleTerminalFailure
// ════════════════════════════════════════════════════════════════════════════

describe("DL-3: handleTerminalFailure — enfileira fallback para o usuário", () => {
  it("enfileira mensagem de fallback para o usuário quando conversa é encontrada", async () => {
    await handleTerminalFailure(jobData);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("conteúdo do fallback é FALLBACK_MESSAGE (sem erro interno)", async () => {
    await handleTerminalFailure(jobData);
    const callArg = mockQueueAdd.mock.calls[0][1] as { content: string };
    expect(callArg.content).toBe(FALLBACK_MESSAGE);
  });

  it("usa jobId estável 'fallback_<messageId>' para idempotência", async () => {
    await handleTerminalFailure(jobData);
    const opts = mockQueueAdd.mock.calls[0][2] as { jobId: string };
    expect(opts.jobId).toBe(`fallback_${jobData.messageId}`);
  });

  it("segunda chamada com mesmo messageId usa mesmo jobId (sem duplicata)", async () => {
    await handleTerminalFailure(jobData);
    await handleTerminalFailure(jobData);
    // BullMQ deduplica por jobId — ambas as chamadas usam o mesmo jobId
    const call1Opts = mockQueueAdd.mock.calls[0][2] as { jobId: string };
    const call2Opts = mockQueueAdd.mock.calls[1][2] as { jobId: string };
    expect(call1Opts.jobId).toBe(call2Opts.jobId);
  });

  it("inclui conversationId e organizationId corretos no job de fallback", async () => {
    await handleTerminalFailure(jobData);
    const callArg = mockQueueAdd.mock.calls[0][1] as {
      conversationId: string;
      organizationId: string;
    };
    expect(callArg.conversationId).toBe(jobData.conversationId);
    expect(callArg.organizationId).toBe(jobData.organizationId);
  });

  it("inclui instanceId e phone do contato", async () => {
    await handleTerminalFailure(jobData);
    const callArg = mockQueueAdd.mock.calls[0][1] as {
      instanceId: string;
      phone: string;
    };
    expect(callArg.instanceId).toBe("inst-1");
    expect(callArg.phone).toBe("5511999999999");
  });

  it("não enfileira se conversa não for encontrada (sem crash)", async () => {
    mockGetConversationById.mockResolvedValue(null);
    await expect(handleTerminalFailure(jobData)).resolves.toBeUndefined();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("não enfileira se evolution_instance_id for null (sem crash)", async () => {
    mockGetConversationById.mockResolvedValue({
      ...mockConversation,
      evolution_instance_id: null,
    });
    await expect(handleTerminalFailure(jobData)).resolves.toBeUndefined();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("não enfileira se phone do contato for null (sem crash)", async () => {
    mockGetConversationById.mockResolvedValue({
      ...mockConversation,
      contacts: null,
    });
    await expect(handleTerminalFailure(jobData)).resolves.toBeUndefined();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("resolve sem crash quando DB falha (graceful degradation)", async () => {
    mockGetConversationById.mockRejectedValue(new Error("DB connection lost"));
    await expect(handleTerminalFailure(jobData)).resolves.toBeUndefined();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("resolve sem crash quando enqueue falha (graceful degradation)", async () => {
    mockQueueAdd.mockRejectedValue(new Error("Redis unavailable"));
    await expect(handleTerminalFailure(jobData)).resolves.toBeUndefined();
  });
});
