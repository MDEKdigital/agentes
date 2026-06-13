import { describe, it, expect } from "vitest";
import { matchesKeyword, isValidRegex } from "../utils/keyword";

describe("matchesKeyword", () => {
  it("retorna false quando array de keywords está vazio", () => {
    expect(matchesKeyword("oi", [])).toBe(false);
  });

  it("retorna true quando mensagem faz match com uma keyword", () => {
    expect(matchesKeyword("Preciso de suporte urgente", ["suporte"])).toBe(true);
  });

  it("matching é case-insensitive", () => {
    expect(matchesKeyword("SUPORTE", ["suporte"])).toBe(true);
  });

  it("suporta regex completa", () => {
    expect(matchesKeyword("oi", ["^oi$"])).toBe(true);
    expect(matchesKeyword("oioi", ["^oi$"])).toBe(false);
  });

  it("retorna false quando mensagem não faz match com nenhuma keyword", () => {
    expect(matchesKeyword("bom dia", ["suporte", "ajuda"])).toBe(false);
  });

  it("ignora silenciosamente regex inválida e continua com as válidas", () => {
    expect(matchesKeyword("preciso de ajuda", ["[abc", "ajuda"])).toBe(true);
  });

  it("ignora regex inválida e retorna false se nenhuma válida fizer match", () => {
    expect(matchesKeyword("oi", ["[abc"])).toBe(false);
  });

  it("filtra keywords com apenas espaços antes de testar", () => {
    expect(matchesKeyword("oi", ["   "])).toBe(false);
  });

  it("retorna o mesmo resultado em chamadas repetidas", () => {
    expect(matchesKeyword("suporte", ["suporte"])).toBe(true);
    expect(matchesKeyword("outro", ["suporte"])).toBe(false);
  });
});

describe("isValidRegex", () => {
  it("aceita regex simples", () => {
    expect(isValidRegex("suporte")).toBe(true);
    expect(isValidRegex("^oi$")).toBe(true);
    expect(isValidRegex("[a-z]+")).toBe(true);
  });

  it("rejeita regex inválida (sintaxe incorreta)", () => {
    expect(isValidRegex("[abc")).toBe(false);
    expect(isValidRegex("(unclosed")).toBe(false);
  });

  it("rejeita padrões com quantificadores aninhados (risco de ReDoS)", () => {
    expect(isValidRegex("(a+)+")).toBe(false);
    expect(isValidRegex("(.*)* ")).toBe(false);
    expect(isValidRegex("(a+){2,}")).toBe(false);
  });

  it("aceita grupos com quantificador mas sem repetição do grupo", () => {
    expect(isValidRegex("(a+)b")).toBe(true);
    expect(isValidRegex("(\\w+)\\s+(\\d+)")).toBe(true);
  });
});

describe("isValidRegex — padrões de alternação (ReDoS)", () => {
  it("rejeita alternação em grupo com quantificador externo (a|aa)+", () => {
    expect(isValidRegex("(a|aa)+")).toBe(false);
  });

  it("rejeita alternação com quantificadores internos (a+|b+)*", () => {
    expect(isValidRegex("(a+|b+)*")).toBe(false);
  });

  it("aceita alternação simples sem quantificador externo (sim|não)", () => {
    expect(isValidRegex("(sim|não)")).toBe(true);
  });

  it("aceita alternação com quantificador interno mas sem outer quant (a+|b)", () => {
    expect(isValidRegex("(a+|b)")).toBe(true);
  });

  it("aceita quantificador ? em grupo (não é ReDoS)", () => {
    expect(isValidRegex("(a+)?")).toBe(true);
  });

  it("rejeita grupo aninhado com quantificador externo (ReDoS): ((a+))+", () => {
    expect(isValidRegex("((a+))+")).toBe(false);
  });

  it("aceita grupo aninhado sem quantificador interno: ((abc))+", () => {
    expect(isValidRegex("((abc))+")).toBe(true);
  });
});

describe("matchesKeyword — não cacheia null para regex inválida", () => {
  it("retorna false para keyword inválida sem lançar exceção", () => {
    const result = matchesKeyword("mensagem qualquer", ["[invalido"]);
    expect(result).toBe(false);
  });

  it("segunda chamada com mesma keyword inválida continua retornando false", () => {
    matchesKeyword("msg", ["[invalido2"]);
    const result2 = matchesKeyword("msg", ["[invalido2"]);
    expect(result2).toBe(false);
  });
});
