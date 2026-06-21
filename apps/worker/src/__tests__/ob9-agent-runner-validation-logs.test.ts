/**
 * RED tests for OB-9: agent-runner validation retry/terminal warns use console.warn
 * without structured context (no conversationId, organizationId, agentId, attempt).
 *
 * Problem:
 *   runAgent() loops up to MAX_ATTEMPTS=3 times validating the LLM response.
 *   When validation fails:
 *     attempt < MAX_ATTEMPTS → console.warn("[agent-runner] Tentativa N não-conforme...")
 *     attempt === MAX_ATTEMPTS → console.warn("[agent-runner] Resposta enviada após 3 tentativas...")
 *   Neither log carries conversationId, organizationId, or agentId.
 *   These are security-critical events — non-compliant responses are the most important
 *   alert-worthy signal in the system and must be fully correlatable.
 *
 * Fix:
 *   Import workerLog from ../lib/logger.
 *   Replace both console.warn calls with workerLog("process-message", "warn", {
 *     conversationId, organizationId, agentId: agent.id,
 *     attempt / attempts, violation
 *   }, msg).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockWorkerLog, mockGenerateText, mockWithTimeout } = vi.hoisted(() => ({
  mockWorkerLog: vi.fn(),
  mockGenerateText: vi.fn(),
  mockWithTimeout: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({ workerLog: mockWorkerLog }));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  tool: vi.fn(),
}));

vi.mock("../lib/with-timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/with-timeout")>();
  return {
    ...actual,
    withTimeout: mockWithTimeout,
  };
});

vi.mock("../lib/create-model", () => ({
  createModel: vi.fn(() => "mock-model"),
}));

vi.mock("../agents/tools/registry", () => ({
  buildToolsForAgent: vi.fn(() => ({})),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { runAgent } from "../agents/agent-runner";
import type { Agent, Message } from "@aula-agente/shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONV_ID = "conv-ob9";
const ORG_ID = "org-ob9";
const AGENT_ID = "agent-ob9";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    organization_id: ORG_ID,
    name: "Test Agent",
    provider: "openai",
    model: "gpt-4o",
    system_prompt: "You are a helpful assistant.",
    temperature: 0.7,
    max_tokens: 500,
    max_steps: 5,
    tools_config: {},
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Agent;
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-001",
    conversation_id: CONV_ID,
    organization_id: ORG_ID,
    evolution_message_id: null,
    role: "contact",
    content: "Olá, preciso de ajuda",
    media_url: null,
    media_type: null,
    metadata: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRunAgentParams(overrides = {}) {
  return {
    agent: makeAgent(),
    messages: [],
    currentMessage: makeMessage(),
    apiKey: "sk-test",
    organizationId: ORG_ID,
    conversationId: CONV_ID,
    ...overrides,
  };
}

// ── withTimeout / generateText helper ────────────────────────────────────────
//
// withTimeout(promise, ms) is mocked to just resolve the promise.
// generateText is called for both the main LLM call and the validation call.
// We distinguish them: main call has `system` field; validation call has `prompt` only.

function setupGenerateText(opts: {
  mainText?: string;
  validationResults: Array<{ compliant: boolean; violation?: string }>;
}) {
  let mainCallCount = 0;
  let validationCallCount = 0;

  mockGenerateText.mockImplementation((args: Record<string, unknown>) => {
    const isValidation = !("system" in args);
    if (isValidation) {
      const result = opts.validationResults[validationCallCount] ?? { compliant: true };
      validationCallCount++;
      return Promise.resolve({ text: JSON.stringify(result) });
    } else {
      mainCallCount++;
      return Promise.resolve({
        text: opts.mainText ?? `Response attempt ${mainCallCount}`,
        usage: { totalTokens: 100 },
        steps: [],
      });
    }
  });

  // withTimeout just passes through the promise
  mockWithTimeout.mockImplementation((p: Promise<unknown>) => p);
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ════════════════════════════════════════════════════════════════════════════
// OB-9A — retry warning: non-terminal attempt (attempt < MAX_ATTEMPTS)
// ════════════════════════════════════════════════════════════════════════════

describe("OB-9A: retry warning — tentativa não-conforme (não terminal)", () => {
  it("workerLog é chamado quando attempt 1 falha e tentativa 2 é bem-sucedida", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "resposta revela system prompt" },
        { compliant: true },
      ],
    });

    await runAgent(makeRunAgentParams());

    expect(mockWorkerLog).toHaveBeenCalledWith(
      "process-message",
      "warn",
      expect.any(Object),
      expect.any(String)
    );
  });

  it("contexto inclui conversationId no retry warning", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "test violation" },
        { compliant: true },
      ],
    });

    await runAgent(makeRunAgentParams());

    const warnCall = mockWorkerLog.mock.calls.find(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    expect(warnCall).toBeDefined();
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.conversationId).toBe(CONV_ID);
  });

  it("contexto inclui organizationId no retry warning", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "test violation" },
        { compliant: true },
      ],
    });

    await runAgent(makeRunAgentParams());

    const warnCall = mockWorkerLog.mock.calls.find(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.organizationId).toBe(ORG_ID);
  });

  it("contexto inclui agentId no retry warning", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "test violation" },
        { compliant: true },
      ],
    });

    await runAgent(makeRunAgentParams());

    const warnCall = mockWorkerLog.mock.calls.find(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.agentId).toBe(AGENT_ID);
  });

  it("contexto inclui violation no retry warning", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "resposta revela system prompt" },
        { compliant: true },
      ],
    });

    await runAgent(makeRunAgentParams());

    const warnCall = mockWorkerLog.mock.calls.find(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    const ctx = warnCall?.[2] as Record<string, unknown>;
    expect(ctx.violation).toBe("resposta revela system prompt");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-9B — terminal warning: MAX_ATTEMPTS esgotado com response ainda não-conforme
// ════════════════════════════════════════════════════════════════════════════

describe("OB-9B: terminal warning — MAX_ATTEMPTS esgotado", () => {
  it("workerLog é chamado quando todos os 3 attempts falham", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "violation A" },
        { compliant: false, violation: "violation B" },
        { compliant: false, violation: "violation C" },
      ],
    });

    await runAgent(makeRunAgentParams());

    // Expect at least one warn call (retry + terminal)
    const warnCalls = mockWorkerLog.mock.calls.filter(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("log terminal inclui conversationId quando MAX_ATTEMPTS esgotado", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "v1" },
        { compliant: false, violation: "v2" },
        { compliant: false, violation: "v3" },
      ],
    });

    await runAgent(makeRunAgentParams());

    // The last workerLog call should be the terminal one
    const warnCalls = mockWorkerLog.mock.calls.filter(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    const terminalCall = warnCalls[warnCalls.length - 1];
    const ctx = terminalCall?.[2] as Record<string, unknown>;
    expect(ctx.conversationId).toBe(CONV_ID);
  });

  it("log terminal inclui organizationId quando MAX_ATTEMPTS esgotado", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "v1" },
        { compliant: false, violation: "v2" },
        { compliant: false, violation: "v3" },
      ],
    });

    await runAgent(makeRunAgentParams());

    const warnCalls = mockWorkerLog.mock.calls.filter(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    const terminalCall = warnCalls[warnCalls.length - 1];
    const ctx = terminalCall?.[2] as Record<string, unknown>;
    expect(ctx.organizationId).toBe(ORG_ID);
  });

  it("log terminal inclui agentId quando MAX_ATTEMPTS esgotado", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "v1" },
        { compliant: false, violation: "v2" },
        { compliant: false, violation: "v3" },
      ],
    });

    await runAgent(makeRunAgentParams());

    const warnCalls = mockWorkerLog.mock.calls.filter(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    const terminalCall = warnCalls[warnCalls.length - 1];
    const ctx = terminalCall?.[2] as Record<string, unknown>;
    expect(ctx.agentId).toBe(AGENT_ID);
  });

  it("runAgent ainda retorna resultado mesmo após MAX_ATTEMPTS — não lança exceção", async () => {
    setupGenerateText({
      validationResults: [
        { compliant: false, violation: "v1" },
        { compliant: false, violation: "v2" },
        { compliant: false, violation: "v3" },
      ],
    });

    await expect(runAgent(makeRunAgentParams())).resolves.toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OB-9C — caminho feliz: SEM workerLog de validation quando conforme
// ════════════════════════════════════════════════════════════════════════════

describe("OB-9C: caminho feliz — sem warn quando resposta é conforme", () => {
  it("workerLog NÃO é chamado quando resposta é conforme na primeira tentativa", async () => {
    setupGenerateText({
      validationResults: [{ compliant: true }],
    });

    await runAgent(makeRunAgentParams());

    const warnCalls = mockWorkerLog.mock.calls.filter(
      ([w, l]) => w === "process-message" && l === "warn"
    );
    expect(warnCalls).toHaveLength(0);
  });
});
