import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateText } = vi.hoisted(() => ({ mockGenerateText: vi.fn() }));
vi.mock("ai", () => ({ generateText: mockGenerateText }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn(() => vi.fn(() => "openai-model")) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: vi.fn(() => vi.fn(() => "anthropic-model")) }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn(() => vi.fn(() => "google-model")) }));

import { evaluateActivation } from "../evaluate-activation";
import type { ActivationRule } from "@aula-agente/shared";

const BASE_PARAMS = {
  provider: "openai" as const,
  apiKey: "sk-test",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evaluateActivation — sem regras", () => {
  it("retorna activate quando não há regras configuradas", async () => {
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "qualquer coisa",
      activationRules: [],
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("activate");
  });
});

describe("evaluateActivation — awaitingConfirmation", () => {
  it("retorna activate imediatamente quando awaitingConfirmation=true", async () => {
    const rules: ActivationRule[] = [{ type: "single_word", value: "suporte" }];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "qualquer mensagem",
      activationRules: rules,
      awaitingConfirmation: true,
    });
    expect(result.action).toBe("activate");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });
});

describe("evaluateActivation — single_word", () => {
  it("retorna activate quando single_word faz match", async () => {
    const rules: ActivationRule[] = [{ type: "single_word", value: "suporte" }];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "preciso de suporte urgente",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("activate");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("retorna ignore quando nenhum single_word faz match", async () => {
    const rules: ActivationRule[] = [{ type: "single_word", value: "cancelar" }];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "bom dia, tudo bem?",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("ignore");
  });
});

describe("evaluateActivation — word_set", () => {
  it("retorna activate quando todas as palavras do set estão presentes", async () => {
    const rules: ActivationRule[] = [{ type: "word_set", words: ["resolver", "atendimento"] }];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "Pode resolver esse atendimento.",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("activate");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("retorna ignore quando falta uma palavra do set", async () => {
    const rules: ActivationRule[] = [{ type: "word_set", words: ["resolver", "atendimento"] }];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "Preciso de ajuda com o atendimento.",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("ignore");
  });
});

describe("evaluateActivation — phrase (LLM)", () => {
  it("retorna activate quando LLM retorna alta confiança", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"matches":true,"confidence":0.95}' });
    const rules: ActivationRule[] = [
      { type: "phrase", intent: "Pode finalizar esse atendimento.", confidence_threshold: 0.7 },
    ];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "era só isso, obrigado",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("activate");
  });

  it("retorna confirm quando LLM retorna confiança média (acima do mínimo, abaixo do threshold)", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"matches":true,"confidence":0.5}' });
    const rules: ActivationRule[] = [
      { type: "phrase", intent: "Pode finalizar esse atendimento.", confidence_threshold: 0.7 },
    ];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "acho que sim",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("confirm");
    expect("confirmationMessage" in result && result.confirmationMessage).toBeTruthy();
  });

  it("retorna ignore quando LLM retorna baixa confiança", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"matches":false,"confidence":0.1}' });
    const rules: ActivationRule[] = [
      { type: "phrase", intent: "Pode finalizar esse atendimento.", confidence_threshold: 0.7 },
    ];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "quero comprar mais produtos",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("ignore");
  });

  it("retorna ignore (falha silenciosa) quando LLM retorna JSON inválido", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "não é json" });
    const rules: ActivationRule[] = [
      { type: "phrase", intent: "finalizar atendimento", confidence_threshold: 0.7 },
    ];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "tudo resolvido",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("ignore");
  });
});

describe("evaluateActivation — ordem de processamento", () => {
  it("phrase é verificado antes de word_set (phrase matches → LLM é chamado, word_set não)", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '{"matches":true,"confidence":0.9}' });
    const rules: ActivationRule[] = [
      { type: "phrase", intent: "finalizar", confidence_threshold: 0.7 },
      { type: "word_set", words: ["resolver", "atendimento"] },
    ];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "pode encerrar",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("activate");
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("word_set é verificado antes de single_word (word_set matches → LLM não é chamado)", async () => {
    const rules: ActivationRule[] = [
      { type: "word_set", words: ["resolver", "atendimento"] },
      { type: "single_word", value: "ajuda" },
    ];
    const result = await evaluateActivation({
      ...BASE_PARAMS,
      messageContent: "pode resolver esse atendimento",
      activationRules: rules,
      awaitingConfirmation: false,
    });
    expect(result.action).toBe("activate");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });
});
