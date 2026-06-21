/**
 * C8 — Lost update: worker process-message vs humano
 *
 * Worker termina após humano marcar "resolved" → não deve sobrescrever.
 * Solução: usar setConversationWaiting (WHERE status != 'resolved') em vez de
 * updateConversation incondicional quando wasResolved=false.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAcquireConversationLock, mockReleaseConversationLock } = vi.hoisted(() => ({
  mockAcquireConversationLock: vi.fn(async () => "lock-value"),
  mockReleaseConversationLock: vi.fn(async () => {}),
}));

const { mockRunAgent } = vi.hoisted(() => ({
  mockRunAgent: vi.fn(async (): Promise<{
    text: string; model: string; tokensUsed: number; latencyMs: number; toolCalls: string[];
  }> => ({
    text: "Resposta",
    model: "gpt-4o-mini",
    tokensUsed: 10,
    latencyMs: 50,
    toolCalls: [],
  })),
}));

const { mockEvaluateActivation } = vi.hoisted(() => ({
  mockEvaluateActivation: vi.fn(async () => ({ action: "activate" as const })),
}));
vi.mock("../evaluate-activation", () => ({ evaluateActivation: mockEvaluateActivation }));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name: string, processor: Function) => ({
    on: vi.fn(),
    _processor: processor,
  })),
}));

const { mockCreateAuditLog, mockSetConversationWaiting, mockUpdateConversation } = vi.hoisted(() => ({
  mockCreateAuditLog: vi.fn().mockResolvedValue({}),
  mockSetConversationWaiting: vi.fn().mockResolvedValue(true),
  mockUpdateConversation: vi.fn().mockResolvedValue({}),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  getAgentById: vi.fn(),
  getRecentMessages: vi.fn(),
  getConversationById: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: mockUpdateConversation,
  setConversationWaiting: mockSetConversationWaiting,
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
  evolutionPostJson: vi.fn(async () => { throw new Error("Not available in tests"); }),
}));
vi.mock("../../agents/agent-runner", () => ({ runAgent: mockRunAgent }));

import {
  getAgentById,
  getConversationById,
  getRecentMessages,
  createMessage,
  getInstanceById,
} from "@aula-agente/database";
import { startProcessMessageWorker } from "../process-message";

const jobData = {
  conversationId: "conv-c8",
  messageId: "msg-c8",
  agentId: "agent-c8",
  organizationId: "org-c8",
};

const activeAgent = {
  id: "agent-c8",
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

const openConversation = {
  id: "conv-c8",
  status: "open",
  is_human_takeover: false,
  is_keyword_activated: true,
  awaiting_activation_confirmation: false,
  evolution_instance_id: "inst-c8",
  contacts: { phone: "5511000000001" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAuditLog.mockResolvedValue({});
  mockSetConversationWaiting.mockResolvedValue(true);
  mockUpdateConversation.mockResolvedValue({});
  mockRunAgent.mockResolvedValue({ text: "ok", model: "gpt-4o-mini", tokensUsed: 10, latencyMs: 50, toolCalls: [] });
  vi.mocked(getAgentById).mockResolvedValue(activeAgent as never);
  vi.mocked(getConversationById).mockResolvedValue(openConversation as never);
  vi.mocked(getRecentMessages).mockResolvedValue([{ id: "msg-c8", role: "contact", content: "oi" }] as never);
  vi.mocked(createMessage).mockResolvedValue({ id: "msg-resp-c8" } as never);
  vi.mocked(getInstanceById).mockResolvedValue({ id: "inst-c8", instance_name: "inst" } as never);
});

async function runJob() {
  const { Worker } = await import("bullmq");
  startProcessMessageWorker();
  const workerInstance = vi.mocked(Worker).mock.results[0].value;
  await workerInstance._processor({ data: jobData });
}

// ── STATUS RACE ───────────────────────────────────────────────────────────────

describe("C8 — race condition worker vs humano (process-message)", () => {

  // 1. Worker usa setConversationWaiting (não updateConversation com status: "waiting")
  it("C8: caminho waiting usa setConversationWaiting (update condicional)", async () => {
    await runJob();

    // RED: current code calls updateConversation with status: "waiting"
    // setConversationWaiting is never called → fails
    expect(mockSetConversationWaiting).toHaveBeenCalledWith(
      expect.anything(),
      "conv-c8",
      "org-c8",
      expect.any(String)  // last_message_at ISO string
    );
  });

  // 2. updateConversation NÃO é chamado com status: "waiting" (guard no DB evita overwrite)
  it("C8: updateConversation NÃO é chamado com status 'waiting' (responsabilidade delegada ao helper)", async () => {
    await runJob();

    // RED: current code calls updateConversation({ status: "waiting" }) directly
    expect(mockUpdateConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: "waiting" }),
      expect.anything()
    );
  });

  // 3. setConversationWaiting retorna false (resolved) → sem regressão no audit
  it("C8: se setConversationWaiting retorna false (conversa resolvida), audit resolved NÃO dispara por race", async () => {
    mockSetConversationWaiting.mockResolvedValue(false); // 0 rows affected
    await runJob();

    // The "conversation.resolved" audit should NOT fire when wasResolved=false
    // (that audit is only for the wasResolved=true path)
    const resolvedAuditCalls = mockCreateAuditLog.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as Record<string, unknown>).action === "conversation.resolved"
    );
    expect(resolvedAuditCalls).toHaveLength(0);
  });

  // 4. Caminho normal: não resolved → setConversationWaiting chamado, conversa vai para waiting
  it("C8: conversa não resolved → setConversationWaiting chamado com sucesso (retorna true)", async () => {
    mockSetConversationWaiting.mockResolvedValue(true);
    await runJob();
    expect(mockSetConversationWaiting).toHaveBeenCalledOnce();
  });

  // 5. Caminho resolved: agent chamou close_conversation → updateConversation com "resolved" (inalterado)
  it("regressão: caminho resolved → updateConversation chamado com status 'resolved'", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Até!",
      model: "gpt-4o-mini",
      tokensUsed: 10,
      latencyMs: 50,
      toolCalls: ["close_conversation"],
    });

    await runJob();

    // This path is unchanged — updateConversation must still be called with "resolved"
    expect(mockUpdateConversation).toHaveBeenCalledWith(
      expect.anything(),
      "conv-c8",
      expect.objectContaining({ status: "resolved" }),
      "org-c8"
    );
  });

  // 6. Caminho resolved: setConversationWaiting NÃO é chamado
  it("regressão: caminho resolved → setConversationWaiting NÃO é chamado", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Até!",
      model: "gpt-4o-mini",
      tokensUsed: 10,
      latencyMs: 50,
      toolCalls: ["close_conversation"],
    });

    await runJob();

    expect(mockSetConversationWaiting).not.toHaveBeenCalled();
  });

  // 7. Audit resolved dispara quando wasResolved=true (regressão)
  it("regressão: audit conversation.resolved dispara quando agente resolve", async () => {
    mockRunAgent.mockResolvedValue({
      text: "Até!",
      model: "gpt-4o-mini",
      tokensUsed: 10,
      latencyMs: 50,
      toolCalls: ["close_conversation"],
    });

    await runJob();

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "conversation.resolved" })
    );
  });

  // 8. Fluxo nominal não quebrado: mensagem criada e enfileirada
  it("regressão: caminho nominal continua criando mensagem e enfileirando send", async () => {
    await runJob();
    expect(createMessage).toHaveBeenCalled();
  });
});
