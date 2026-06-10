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
