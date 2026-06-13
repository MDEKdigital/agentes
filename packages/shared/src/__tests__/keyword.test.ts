import { describe, it, expect } from "vitest";
import { matchesKeyword } from "../utils/keyword";

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

  it("reutiliza regex compilada (cache) sem alterar resultado", () => {
    expect(matchesKeyword("suporte", ["suporte"])).toBe(true);
    expect(matchesKeyword("outro", ["suporte"])).toBe(false);
  });
});
