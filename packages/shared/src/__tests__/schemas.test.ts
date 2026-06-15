import { describe, it, expect } from "vitest";
import { createAgentSchema } from "../schemas/agent";

describe("createAgentSchema", () => {
  const valid = {
    name: "Agente Teste",
    system_prompt: "Você é um assistente.",
    model: "gpt-4o-mini",
    provider: "openai" as const,
  };

  it("aceita payload válido com defaults", () => {
    const result = createAgentSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_steps).toBe(5);
      expect(result.data.temperature).toBe(0.7);
      expect(result.data.max_tokens).toBe(1024);
    }
  });

  it("aceita max_steps dentro do range (1–20)", () => {
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 1 }).success).toBe(true);
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 20 }).success).toBe(true);
  });

  it("rejeita max_steps fora do range", () => {
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 0 }).success).toBe(false);
    expect(createAgentSchema.safeParse({ ...valid, max_steps: 21 }).success).toBe(false);
  });

  it("rejeita provider inválido", () => {
    const result = createAgentSchema.safeParse({ ...valid, provider: "mistral" });
    expect(result.success).toBe(false);
  });

  it("rejeita name vazio", () => {
    const result = createAgentSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita system_prompt vazio", () => {
    const result = createAgentSchema.safeParse({ ...valid, system_prompt: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita temperature fora do range (0–2)", () => {
    expect(createAgentSchema.safeParse({ ...valid, temperature: -0.1 }).success).toBe(false);
    expect(createAgentSchema.safeParse({ ...valid, temperature: 2.1 }).success).toBe(false);
  });
});

describe("activation_rules", () => {
  const valid = {
    name: "Agente Teste",
    system_prompt: "Você é um assistente.",
    model: "gpt-4o-mini",
    provider: "openai" as const,
  };

  it("aceita array vazio por default", () => {
    const result = createAgentSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activation_rules).toEqual([]);
    }
  });

  it("aceita single_word com regex válida", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "single_word", value: "^ajuda$" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita single_word com regex inválida", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "single_word", value: "(unclosed" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejeita single_word com padrão ReDoS", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "single_word", value: "(a+)+" }],
    });
    expect(result.success).toBe(false);
  });

  it("aceita word_set com 2+ palavras", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "word_set", words: ["suporte", "urgente"] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejeita word_set com menos de 2 palavras", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "word_set", words: ["suporte"] }],
    });
    expect(result.success).toBe(false);
  });

  it("aceita phrase com campos válidos", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "phrase", intent: "Finalizar atendimento", confidence_threshold: 0.8 }],
    });
    expect(result.success).toBe(true);
  });

  it("phrase usa confidence_threshold 0.7 por default", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "phrase", intent: "Finalizar atendimento" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const rule = result.data.activation_rules[0] as { type: "phrase"; confidence_threshold: number };
      expect(rule.confidence_threshold).toBe(0.7);
    }
  });

  it("rejeita type desconhecido", () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      activation_rules: [{ type: "unknown", value: "algo" }],
    });
    expect(result.success).toBe(false);
  });
});
