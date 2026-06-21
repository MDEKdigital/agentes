/**
 * RED tests for RC-9: evaluateActivation.matchPhrase calls generateText without timeout.
 *
 * Problem:
 *   matchPhrase() calls generateText({ model, prompt, maxTokens: 60 }) with no
 *   abortSignal and no withTimeout wrapper. If the LLM provider hangs, the entire
 *   process-message job is blocked indefinitely — same stall risk that RC-1/RC-2
 *   fixed for agent-runner.ts and Whisper, but missed for evaluate-activation.ts.
 *
 * Fix:
 *   Wrap the generateText call in matchPhrase with withTimeout(..., LLM_TIMEOUT_MS),
 *   mirroring the pattern already used in agent-runner.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockWithTimeout, mockGenerateText } = vi.hoisted(() => ({
  mockWithTimeout: vi.fn(),
  mockGenerateText: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("../lib/with-timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/with-timeout")>();
  return {
    ...actual,
    withTimeout: mockWithTimeout,
  };
});

vi.mock("../lib/create-model", () => ({
  createModel: vi.fn(() => "mocked-model"),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { evaluateActivation } from "../workers/evaluate-activation";
import { LLM_TIMEOUT_MS } from "../lib/with-timeout";

// ── Constants ─────────────────────────────────────────────────────────────────

const phraseRule = {
  type: "phrase" as const,
  intent: "quero comprar",
  confidence_threshold: 0.7,
};

const wordSetRule = {
  type: "word_set" as const,
  words: ["comprar", "produto"],
};

const singleWordRule = {
  type: "single_word" as const,
  value: "comprar",
};

const baseParams = {
  provider: "openai" as const,
  apiKey: "sk-test",
  awaitingConfirmation: false,
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeGenerateTextResult(matches: boolean, confidence: number) {
  return { text: JSON.stringify({ matches, confidence }) };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: withTimeout behaves like identity (passes through the promise)
  mockWithTimeout.mockImplementation((p: Promise<unknown>) => p);
  // Default: generateText resolves immediately with no match
  mockGenerateText.mockResolvedValue(makeGenerateTextResult(false, 0.1));
});

// ════════════════════════════════════════════════════════════════════════════
// RC-9A — withTimeout chamado com LLM_TIMEOUT_MS em regras do tipo phrase
// ════════════════════════════════════════════════════════════════════════════

describe("RC-9A: matchPhrase — withTimeout chamado com LLM_TIMEOUT_MS", () => {
  it("withTimeout é chamado quando há uma regra do tipo phrase", async () => {
    await evaluateActivation({
      ...baseParams,
      messageContent: "quero comprar",
      activationRules: [phraseRule],
    });

    expect(mockWithTimeout).toHaveBeenCalled();
  });

  it("withTimeout é chamado com LLM_TIMEOUT_MS como segundo argumento", async () => {
    await evaluateActivation({
      ...baseParams,
      messageContent: "quero comprar",
      activationRules: [phraseRule],
    });

    expect(mockWithTimeout).toHaveBeenCalledWith(expect.any(Promise), LLM_TIMEOUT_MS);
  });

  it("withTimeout recebe a Promise de generateText (não um valor resolvido)", async () => {
    const neverResolves = new Promise(() => {});
    mockGenerateText.mockReturnValueOnce(neverResolves);
    // withTimeout should receive the original unresolved promise
    mockWithTimeout.mockResolvedValueOnce(makeGenerateTextResult(false, 0));

    await evaluateActivation({
      ...baseParams,
      messageContent: "quero comprar",
      activationRules: [phraseRule],
    });

    const [firstArg] = mockWithTimeout.mock.calls[0];
    // The promise passed to withTimeout must be the same object from generateText
    expect(firstArg).toBe(neverResolves);
  });

  it("withTimeout é chamado uma vez por regra phrase (paralelismo via Promise.all)", async () => {
    const secondPhraseRule = { type: "phrase" as const, intent: "quero cancelar", confidence_threshold: 0.8 };

    await evaluateActivation({
      ...baseParams,
      messageContent: "alguma mensagem",
      activationRules: [phraseRule, secondPhraseRule],
    });

    expect(mockWithTimeout).toHaveBeenCalledTimes(2);
    expect(mockWithTimeout.mock.calls[0][1]).toBe(LLM_TIMEOUT_MS);
    expect(mockWithTimeout.mock.calls[1][1]).toBe(LLM_TIMEOUT_MS);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-9B — matchPhrase com timeout não bloqueia evaluateActivation
// ════════════════════════════════════════════════════════════════════════════

describe("RC-9B: matchPhrase timeout — degradação graciosa", () => {
  it("quando withTimeout rejeita (simula timeout de LLM), evaluateActivation não lança", async () => {
    mockWithTimeout.mockRejectedValueOnce(new Error("LLM call timed out after 120000ms"));

    await expect(
      evaluateActivation({
        ...baseParams,
        messageContent: "quero comprar",
        activationRules: [phraseRule],
      })
    ).resolves.not.toThrow();
  });

  it("quando phrase rule timed out, resultado é 'ignore' (degradação conservadora)", async () => {
    mockWithTimeout.mockRejectedValueOnce(new Error("LLM call timed out after 120000ms"));

    const result = await evaluateActivation({
      ...baseParams,
      messageContent: "quero comprar",
      activationRules: [phraseRule],
    });

    expect(result.action).toBe("ignore");
  });

  it("quando phrase timed out mas word_set ativa, resultado é 'activate'", async () => {
    mockWithTimeout.mockRejectedValueOnce(new Error("LLM call timed out after 120000ms"));

    const result = await evaluateActivation({
      ...baseParams,
      messageContent: "quero comprar produto",
      activationRules: [phraseRule, wordSetRule],
    });

    // word_set rule matches "comprar" AND "produto" in message
    expect(result.action).toBe("activate");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-9C — word_set e single_word não chamam withTimeout (sem LLM)
// ════════════════════════════════════════════════════════════════════════════

describe("RC-9C: regras sem phrase — withTimeout não é chamado", () => {
  it("word_set rule não chama withTimeout", async () => {
    const result = await evaluateActivation({
      ...baseParams,
      messageContent: "quero comprar produto",
      activationRules: [wordSetRule],
    });

    expect(mockWithTimeout).not.toHaveBeenCalled();
    expect(result.action).toBe("activate");
  });

  it("single_word rule não chama withTimeout", async () => {
    const result = await evaluateActivation({
      ...baseParams,
      messageContent: "comprar",
      activationRules: [singleWordRule],
    });

    expect(mockWithTimeout).not.toHaveBeenCalled();
    expect(result.action).toBe("activate");
  });

  it("sem regras — não chama withTimeout e ativa imediatamente", async () => {
    const result = await evaluateActivation({
      ...baseParams,
      messageContent: "qualquer mensagem",
      activationRules: [],
    });

    expect(mockWithTimeout).not.toHaveBeenCalled();
    expect(result.action).toBe("activate");
  });
});
