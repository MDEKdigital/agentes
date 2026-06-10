import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("@aula-agente/shared", () => ({
  QUEUE_NAMES: { PROCESS_MESSAGE: "process-message" },
}));
vi.mock("../../lib/redis", () => ({ getConnectionOptions: vi.fn(() => ({})) }));
vi.mock("../../lib/lock", () => ({
  acquireConversationLock: vi.fn(async () => "lock-value"),
  releaseConversationLock: vi.fn(async () => {}),
}));
vi.mock("../../lib/vault", () => ({ resolveApiKey: vi.fn(async () => "sk-test") }));
vi.mock("../../agents/agent-runner", () => ({
  runAgent: vi.fn(async () => ({
    text: "Resposta do agente",
    model: "gpt-4o-mini",
    tokensUsed: 50,
    latencyMs: 100,
    toolCalls: [],
  })),
}));

import {
  getAgentById,
  getConversationById,
  getRecentMessages,
  createMessage,
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
};

const conversation = {
  id: "conv-1",
  is_human_takeover: false,
  evolution_instance_id: "inst-1",
  contacts: { phone: "5511999999999" },
};

const messages = [
  { id: "msg-1", role: "contact", content: "Olá" },
];

beforeEach(() => {
  vi.clearAllMocks();
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
    const { releaseConversationLock } = await import("../../lib/lock");

    await expect(runJob()).rejects.toThrow("DB error");
    expect(releaseConversationLock).toHaveBeenCalled();
  });
});
