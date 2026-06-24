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
  setConversationWaiting: vi.fn().mockResolvedValue(true),
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
  renewConversationLock: vi.fn().mockResolvedValue(true),
  LOCK_RENEWAL_INTERVAL_MS: 15_000,
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
  setConversationWaiting,
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
  tools_config: { search_knowledge: false, search_faq: false, search_web: false },
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
  { id: "msg-1", role: "contact", content: "OlÃ¡" },
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
  it("nÃ£o processa se agente estiver inativo", async () => {
    vi.mocked(getAgentById).mockResolvedValue({ ...activeAgent, is_active: false } as never);
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("nÃ£o processa se conversa estiver em human takeover", async () => {
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
      expect.objectContaining({ phone: "5511999999999" }),
      expect.objectContaining({ jobId: "msg-1_agent_response_part_0", delay: 0 })
    );
  });

  it("libera o lock mesmo em caso de erro", async () => {
    vi.mocked(getConversationById).mockRejectedValue(new Error("DB error"));

    await expect(runJob()).rejects.toThrow("DB error");
    expect(mockReleaseConversationLock).toHaveBeenCalled();
  });

  it("resposta multi-parte: part_0 com delay=0, part_1 com delay=7000 (garante INTER_PART_DELAY_MS > backoff)", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Primeira parte.\n\nSegunda parte.",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: [],
    });
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as never);

    await runJob();

    expect(sendQueue.add).toHaveBeenCalledTimes(2);
    expect(sendQueue.add).toHaveBeenNthCalledWith(
      1,
      "send-message",
      expect.objectContaining({ content: "Primeira parte." }),
      expect.objectContaining({ jobId: "msg-1_agent_response_part_0", delay: 0 })
    );
    expect(sendQueue.add).toHaveBeenNthCalledWith(
      2,
      "send-message",
      expect.objectContaining({ content: "Segunda parte." }),
      expect.objectContaining({ jobId: "msg-1_agent_response_part_1", delay: 7000 })
    );
  });

  it("agente retorna string vazia â€” nÃ£o salva no DB e nÃ£o enfileira sendQueue", async () => {
    mockRunAgent.mockResolvedValue({
      text: "",
      model: "gpt-4o-mini",
      tokensUsed: 0,
      latencyMs: 50,
      toolCalls: [],
    });
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as never);

    await runJob();

    expect(createMessage).not.toHaveBeenCalled();
    expect(sendQueue.add).not.toHaveBeenCalled();
  });

  it("passa conversationId para runAgent", async () => {
    await runJob();
    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1" })
    );
  });

  it("seta status 'waiting' quando agente nÃ£o chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Resposta",
      model: "gpt-4o-mini",
      tokensUsed: 50,
      latencyMs: 100,
      toolCalls: [],
    });

    await runJob();

    // C8: now uses setConversationWaiting (conditional update) instead of updateConversation
    expect(setConversationWaiting).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      "org-1",
      expect.any(String)
    );
  });

  it("seta status 'resolved' quando agente chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "AtÃ© logo!",
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

  it("nÃ£o filtra quando agente nÃ£o tem regras de ativaÃ§Ã£o", async () => {
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });

  it("nÃ£o filtra quando conversa jÃ¡ estÃ¡ ativada", async () => {
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
      activation_rules: [{ type: "single_word", value: "olÃ¡" }],
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

  it("nÃ£o ativa quando mÃ­dia falhou na transcriÃ§Ã£o (isMediaFallback)", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_rules: [{ type: "single_word", value: "processar" }],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
      awaiting_activation_confirmation: false,
    } as never);
    // Audio message â€” preprocessAudioMessage will fail (evolution mock throws) â†’ isMediaFallback=true
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

// â”€â”€ audit log assertions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("audit logs â€” process-message", () => {
  it("(audit): keyword ativada â†’ registra conversation.keyword_activated", async () => {
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

  it("(audit): NÃƒO audita keyword_activated quando conversa jÃ¡ estÃ¡ ativada", async () => {
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

  it("(audit): conversa resolvida pelo agente â†’ registra conversation.resolved", async () => {
    mockRunAgent.mockResolvedValue({
      text: "AtÃ© logo!",
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

  it("(audit): NÃƒO audita conversation.resolved quando agente nÃ£o chamou close_conversation", async () => {
    mockRunAgent.mockResolvedValue({
      text: "OlÃ¡!",
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

  it("R14: conversation.keyword_activated carrega actor=system no metadata", async () => {
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
        metadata: expect.objectContaining({ actor: "system" }),
      })
    );
  });
});

// â”€â”€ R6: idempotÃªncia em retry de conversa jÃ¡ resolvida â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("R6: retry com conversa jÃ¡ resolved â€” NÃƒO emite segundo conversation.resolved", () => {
  it("R6: conversation.status=resolved â†’ job retorna sem auditar conversation.resolved", async () => {
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      status: "resolved",
    } as never);
    mockRunAgent.mockResolvedValue({
      text: "AtÃ© logo!",
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

// â”€â”€ C1 + C14: idempotÃªncia em retry de process-message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("C1 â€” resposta do agente nÃ£o deve ser duplicada em retry", () => {
  it("C1 nominal: createMessage de resposta inclui source_message_id no metadata", async () => {
    await runJob();

    expect(createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        role: "agent",
        metadata: expect.objectContaining({ source_message_id: "msg-1" }),
      })
    );
  });

  it("C1: sendQueue.add para resposta usa jobId estÃ¡vel baseado em messageId", async () => {
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as never);

    await runJob();

    expect(sendQueue.add).toHaveBeenCalledWith(
      "send-message",
      expect.any(Object),
      expect.objectContaining({ jobId: "msg-1_agent_response_part_0", delay: 0 })
    );
  });

  it("C1: retry nÃ£o chama runAgent quando resposta jÃ¡ existe no histÃ³rico para messageId", async () => {
    vi.mocked(getRecentMessages).mockResolvedValue([
      { id: "msg-1", role: "contact", content: "OlÃ¡", metadata: null },
      {
        id: "msg-resp-existing",
        role: "agent",
        content: "Resposta anterior",
        metadata: { source_message_id: "msg-1", tool_calls: [] },
      },
    ] as never);

    await runJob();

    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it("C1: retry nÃ£o cria segunda mensagem de resposta do agente", async () => {
    vi.mocked(getRecentMessages).mockResolvedValue([
      { id: "msg-1", role: "contact", content: "OlÃ¡", metadata: null },
      {
        id: "msg-resp-existing",
        role: "agent",
        content: "Resposta anterior",
        metadata: { source_message_id: "msg-1", tool_calls: [] },
      },
    ] as never);

    await runJob();

    expect(createMessage).not.toHaveBeenCalled();
  });

  it("C1: retry enfileira send-message usando id da resposta existente (garante entrega)", async () => {
    vi.mocked(getRecentMessages).mockResolvedValue([
      { id: "msg-1", role: "contact", content: "OlÃ¡", metadata: null },
      {
        id: "msg-resp-existing",
        role: "agent",
        content: "Resposta anterior",
        metadata: { source_message_id: "msg-1", tool_calls: [] },
      },
    ] as never);
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as never);

    await runJob();

    expect(sendQueue.add).toHaveBeenCalledWith(
      "send-message",
      expect.objectContaining({ messageId: "msg-resp-existing" }),
      expect.any(Object)
    );
  });

  it("C1: audit conversation.resolved dispara corretamente via metadata da resposta existente", async () => {
    vi.mocked(getRecentMessages).mockResolvedValue([
      { id: "msg-1", role: "contact", content: "OlÃ¡", metadata: null },
      {
        id: "msg-resp-existing",
        role: "agent",
        content: "AtÃ© logo!",
        metadata: { source_message_id: "msg-1", tool_calls: ["close_conversation"] },
      },
    ] as never);

    await runJob();

    const resolvedCalls = mockCreateAuditLog.mock.calls.filter(
      (args: unknown[]) => (args[1] as { action: string })?.action === "conversation.resolved"
    );
    // current code: runAgent returns [] toolCalls â†’ no audit â†’ 0 calls â†’ FAIL (expects 1)
    // after fix: reads tool_calls from metadata â†’ wasResolved=true â†’ audit fires â†’ 1 call
    expect(resolvedCalls).toHaveLength(1);
  });
});

describe("C14 â€” mensagem de confirmaÃ§Ã£o nÃ£o deve ser duplicada em retry", () => {
  const withActivationRules = {
    ...activeAgent,
    activation_rules: [{ type: "single_word", value: "suporte" }],
  };
  const unactivatedConv = {
    ...conversation,
    is_keyword_activated: false,
    awaiting_activation_confirmation: false,
  };

  beforeEach(() => {
    mockEvaluateActivation.mockResolvedValue({
      action: "confirm" as const,
      confirmationMessage: "VocÃª quis dizer 'suporte'?",
    });
    vi.mocked(getAgentById).mockResolvedValue(withActivationRules as never);
    vi.mocked(getConversationById).mockResolvedValue(unactivatedConv as never);
    vi.mocked(getRecentMessages).mockResolvedValue([
      { id: "msg-1", role: "contact", content: "suporte", metadata: null },
    ] as never);
    vi.mocked(createMessage).mockResolvedValue({ id: "confirm-new" } as never);
  });

  it("C14 nominal: createMessage de confirmaÃ§Ã£o inclui source_message_id e type no metadata", async () => {
    await runJob();

    expect(createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        role: "agent",
        metadata: expect.objectContaining({
          source_message_id: "msg-1",
          type: "activation_confirmation",
        }),
      })
    );
  });

  it("C14: sendQueue.add para confirmaÃ§Ã£o usa jobId estÃ¡vel baseado em messageId", async () => {
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as never);

    await runJob();

    expect(sendQueue.add).toHaveBeenCalledWith(
      "send-message",
      expect.any(Object),
      expect.objectContaining({ jobId: "msg-1_confirmation" })
    );
  });

  it("C14: retry nÃ£o cria segunda mensagem de confirmaÃ§Ã£o quando jÃ¡ existe no histÃ³rico", async () => {
    vi.mocked(getRecentMessages).mockResolvedValue([
      { id: "msg-1", role: "contact", content: "suporte", metadata: null },
      {
        id: "confirm-existing",
        role: "agent",
        content: "VocÃª quis dizer 'suporte'?",
        metadata: { source_message_id: "msg-1", type: "activation_confirmation" },
      },
    ] as never);

    await runJob();

    // current code: createMessage IS called again â†’ FAIL â†’ RED
    // after fix: existing found â†’ createMessage NOT called â†’ GREEN
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("C14: retry enfileira send-message de confirmaÃ§Ã£o com id existente", async () => {
    vi.mocked(getRecentMessages).mockResolvedValue([
      { id: "msg-1", role: "contact", content: "suporte", metadata: null },
      {
        id: "confirm-existing",
        role: "agent",
        content: "VocÃª quis dizer 'suporte'?",
        metadata: { source_message_id: "msg-1", type: "activation_confirmation" },
      },
    ] as never);
    const sendQueue = { add: vi.fn() };
    vi.mocked(getSendMessageQueue).mockReturnValue(sendQueue as never);

    await runJob();

    expect(sendQueue.add).toHaveBeenCalledWith(
      "send-message",
      expect.objectContaining({ messageId: "confirm-existing" }),
      expect.any(Object)
    );
  });
});
