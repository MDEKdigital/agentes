import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAcquireConversationLock, mockReleaseConversationLock } = vi.hoisted(() => ({
  mockAcquireConversationLock: vi.fn(async () => "lock-value"),
  mockReleaseConversationLock: vi.fn(async () => {}),
}));

const { mockRunAgent } = vi.hoisted(() => ({
  mockRunAgent: vi.fn(async (): Promise<{ text: string; model: string; tokensUsed: number; latencyMs: number; toolCalls: string[] }> => ({
    text: "Resposta do agente",
    model: "gpt-4o-mini",
    tokensUsed: 50,
    latencyMs: 100,
    toolCalls: [],
  })),
}));

const { mockEvaluateActivation } = vi.hoisted(() => ({
  mockEvaluateActivation: vi.fn(async (): Promise<
    | { action: "activate" }
    | { action: "ignore" }
    | { action: "confirm"; confirmationMessage: string }
  > => ({ action: "activate" })),
}));
vi.mock("../evaluate-activation", () => ({
  evaluateActivation: mockEvaluateActivation,
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
}));
const { mockCreateAuditLog } = vi.hoisted(() => ({
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
  getInstanceById: vi.fn(),
  createAuditLog: mockCreateAuditLog,
}));
vi.mock("@aula-agente/queue", () => ({
  getSendMessageQueue: vi.fn(() => ({ add: vi.fn() })),
}));
vi.mock("@aula-agente/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aula-agente/shared")>();
  return { ...actual, QUEUE_NAMES: { PROCESS_MESSAGE: "process-message" } };
});
vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../../lib/lock", () => ({
  acquireConversationLock: mockAcquireConversationLock,
  releaseConversationLock: mockReleaseConversationLock,
}));
vi.mock("../../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../../lib/evolution", () => ({
  evolutionPostJson: vi.fn(async () => { throw new Error("Evolution API not available in tests"); }),
}));
vi.mock("../../agents/agent-runner", () => ({
  runAgent: mockRunAgent,
}));

import {
  getAgentById,
  getConversationById,
  getRecentMessages,
  createMessage,
  updateConversation,
  getInstanceById,
} from "@aula-agente/database";
import { getSendMessageQueue } from "@aula-agente/queue";
import { startProcessMessageWorker } from "../process-message";

const jobData = {
  conversationId: "conv-1",
  messageId: "msg-1",
  agentId: "agent-1",
  organizationId: "org-1",
};

const activeAgent = {
  id: "agent-1",
  provider: "openai",
  model: "gpt-4o-mini",
  system_prompt: "...",
  temperature: 0.7,
  max_tokens: 1024,
  max_steps: 5,
  tools_config: { search_knowledge: false, search_faq: false },
  is_active: true,
  activation_rules: [],
};

const conversation = {
  id: "conv-1",
  is_human_takeover: false,
  is_keyword_activated: true,
  awaiting_activation_confirmation: false,
  evolution_instance_id: "inst-1",
  contacts: { phone: "5511999999999" },
};

const messages = [
  { id: "msg-1", role: "contact", content: "Olá" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAuditLog.mockResolvedValue({});
  mockRunAgent.mockResolvedValue({
    text: "Resposta do agente",
    model: "gpt-4o-mini",
    tokensUsed: 50,
    latencyMs: 100,
    toolCalls: [],
  });
  vi.mocked(getAgentById).mockResolvedValue(activeAgent as never);
  vi.mocked(getConversationById).mockResolvedValue(conversation as never);
  vi.mocked(getRecentMessages).mockResolvedValue(messages as never);
  vi.mocked(createMessage).mockResolvedValue({ id: "msg-resp-1" } as never);
  vi.mocked(getInstanceById).mockResolvedValue({ id: "inst-1", instance_name: "inst-name" } as never);
});

async function runJob() {
  const { Worker } = await import("bullmq");
  startProcessMessageWorker();
  const workerInstance = vi.mocked(Worker).mock.results[0].value;
  await workerInstance._processor({ data: jobData });
}

describe("startProcessMessageWorker", () => {
  it("não processa se agente estiver inativo", async () => {
    vi.mocked(getAgentById).mockResolvedValue({ ...activeAgent, is_active: false } as never);
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("não processa se conversa estiver em human takeover", async () => {
    vi.mocked(getConversationById).mockResolvedValue({ ...conversation, is_human_takeover: true } as never);
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("caminho feliz: salva resposta e enfileira send-message", async () => {
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as never);

    await runJob();

    expect(createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "agent", content: "Resposta do agente" })
    );
    expect(sendQueue.add).toHaveBeenCalledWith(
      "send-message",
      expect.objectContaining({ phone: "5511999999999" })
    );
  });

  it("libera o lock mesmo em caso de erro", async () => {
    vi.mocked(getConversationById).mockRejectedValue(new Error("DB error"));

    await expect(runJob()).rejects.toThrow("DB error");
    expect(mockReleaseConversationLock).toHaveBeenCalled();
  });

  it("passa conversationId para runAgent", async () => {
    await runJob();
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1" })
    );
  });

  it("seta status 'waiting' quando agente não chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Resposta",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: [],
    });

    await runJob();

    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ status: "waiting" }),
      "org-1"
    );
  });

  it("seta status 'resolved' quando agente chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Até logo!",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: ["close_conversation"],
    });

    await runJob();

    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ status: "resolved" }),
      "org-1"
    );
  });
});

describe("keyword gate", () => {
  beforeEach(() => {
    mockEvaluateActivation.mockResolvedValue({ action: "activate" as const });
  });

  it("não filtra quando agente não tem regras de ativação", async () => {
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });

  it("não filtra quando conversa já está ativada", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_rules: [{ type: "single_word", value: "suporte" }],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: true,
      awaiting_activation_confirmation: false,
    } as never);
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });

  it("filtra silenciosamente quando nenhuma regra ativa", async () => {
    mockEvaluateActivation.mockResolvedValue({ action: "ignore" as const });
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_rules: [{ type: "single_word", value: "suporte" }],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
      awaiting_activation_confirmation: false,
    } as never);
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("ativa conversa e processa quando regra faz match", async () => {
    const { updateConversation } = await import("@aula-agente/database");
    mockEvaluateActivation.mockResolvedValue({ action: "activate" as const });
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_rules: [{ type: "single_word", value: "olá" }],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
      awaiting_activation_confirmation: false,
    } as never);
    await runJob();
    // is_keyword_activated is now committed before runAgent for retry idempotency.
    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ is_keyword_activated: true }),
      "org-1"
    );
    expect(createMessage).toHaveBeenCalled();
  });

  it("não ativa quando mídia falhou na transcrição (isMediaFallback)", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_rules: [{ type: "single_word", value: "processar" }],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
      awaiting_activation_confirmation: false,
    } as never);
    // Audio message — preprocessAudioMessage will fail (evolution mock throws) → isMediaFallback=true
    vi.mocked(getRecentMessages).mockResolvedValue([
      {
        id: "msg-1",
        conversation_id: "conv-1",
        organization_id: "org-1",
        role: "contact" as const,
        content: "audio_original_content",
        media_type: "audio",
        media_url: null,
        evolution_message_id: "evo-1",
        metadata: {},
        created_at: new Date().toISOString(),
      },
    ] as never);

    await runJob();

    expect(createMessage).not.toHaveBeenCalled();
    expect(updateConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ is_keyword_activated: true })
    );
  });

  it("persiste is_keyword_activated antes de runAgent para sobreviver a retry", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_rules: [{ type: "single_word", value: "suporte" }],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
      awaiting_activation_confirmation: false,
    } as never);
    vi.mocked(getRecentMessages).mockResolvedValue([
      {
        id: "msg-1",
        conversation_id: "conv-1",
        organization_id: "org-1",
        role: "contact" as const,
        content: "suporte",
        media_type: null,
        media_url: null,
        evolution_message_id: null,
        metadata: {},
        created_at: new Date().toISOString(),
      },
    ] as never);

    mockRunAgent.mockRejectedValueOnce(new Error("LLM timeout"));

    await expect(runJob()).rejects.toThrow("LLM timeout");

    // is_keyword_activated must be committed BEFORE runAgent throws
    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ is_keyword_activated: true }),
      "org-1"
    );
  });
});

// ── audit log assertions ───────────────────────────────────────────────────────

describe("audit logs — process-message", () => {
  it("(audit): keyword ativada → registra conversation.keyword_activated", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_rules: [{ type: "single_word", value: "suporte" }],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
      awaiting_activation_confirmation: false,
    } as never);
    mockEvaluateActivation.mockResolvedValue({ action: "activate" as const });

    await runJob();

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.keyword_activated",
        entity_type: "conversation",
        entity_id: "conv-1",
        organization_id: "org-1",
      })
    );
  });

  it("(audit): NÃO audita keyword_activated quando conversa já está ativada", async () => {
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: true,
      awaiting_activation_confirmation: false,
    } as never);

    await runJob();

    const keywordCalls = mockCreateAuditLog.mock.calls.filter(
      (args: unknown[]) => (args[1] as { action: string })?.action === "conversation.keyword_activated"
    );
    expect(keywordCalls).toHaveLength(0);
  });

  it("(audit): conversa resolvida pelo agente → registra conversation.resolved", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Até logo!",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: ["close_conversation"],
    });

    await runJob();

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "conversation.resolved",
        entity_type: "conversation",
        entity_id: "conv-1",
        organization_id: "org-1",
      })
    );
  });

  it("(audit): NÃO audita conversation.resolved quando agente não chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Olá!",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: [],
    });

    await runJob();

    const resolvedCalls = mockCreateAuditLog.mock.calls.filter(
      (args: unknown[]) => (args[1] as { action: string })?.action === "conversation.resolved"
    );
    expect(resolvedCalls).toHaveLength(0);
  });
});

// ── R6: idempotência em retry de conversa já resolvida ─────────────────────────

describe("R6: retry com conversa já resolved — NÃO emite segundo conversation.resolved", () => {
  it("R6: conversation.status=resolved → job retorna sem auditar conversation.resolved", async () => {
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      status: "resolved",
    } as never);
    mockRunAgent.mockResolvedValue({
      text: "Até logo!",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: ["close_conversation"],
    });

    await runJob();

    const resolvedCalls = mockCreateAuditLog.mock.calls.filter(
      (args: unknown[]) => (args[1] as { action: string })?.action === "conversation.resolved"
    );
    expect(resolvedCalls).toHaveLength(0);
  });
});
