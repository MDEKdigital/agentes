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

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
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
  activation_keywords: [],
};

const conversation = {
  id: "conv-1",
  is_human_takeover: false,
  is_keyword_activated: true,
  evolution_instance_id: "inst-1",
  contacts: { phone: "5511999999999" },
};

const messages = [
  { id: "msg-1", role: "contact", content: "Olá" },
];

beforeEach(() => {
  vi.clearAllMocks();
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
      expect.objectContaining({ status: "waiting" })
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
      expect.objectContaining({ status: "resolved" })
    );
  });
});

describe("keyword gate", () => {
  it("não filtra quando agente não tem keywords", async () => {
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });

  it("não filtra quando conversa já está ativada", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_keywords: ["suporte"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: true,
    } as never);
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });

  it("filtra silenciosamente quando keyword não faz match", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_keywords: ["^suporte$"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
    } as never);
    await runJob();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("ativa conversa e processa quando keyword faz match", async () => {
    const { updateConversation } = await import("@aula-agente/database");
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_keywords: ["olá"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
    } as never);
    await runJob();
    // is_keyword_activated is now committed before runAgent for retry idempotency.
    expect(updateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ is_keyword_activated: true })
    );
    expect(createMessage).toHaveBeenCalled();
  });

  it("não ativa keyword quando mídia falhou na transcrição (placeholder)", async () => {
    vi.mocked(getAgentById).mockResolvedValue({
      ...activeAgent,
      activation_keywords: ["processar"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
    } as never);
    // Audio message with original content (not the placeholder)
    // preprocessAudioMessage will fail (evolution mock throws) and return the placeholder
    // which contains "processar" — but isMediaFallback should block keyword match
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
      activation_keywords: ["suporte"],
    } as never);
    vi.mocked(getConversationById).mockResolvedValue({
      ...conversation,
      is_keyword_activated: false,
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
      expect.objectContaining({ is_keyword_activated: true })
    );
  });
});
