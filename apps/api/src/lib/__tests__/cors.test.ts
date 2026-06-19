import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseAllowedOrigins, isOriginAllowed } from "../cors";

let savedOrigins: string | undefined;

beforeEach(() => {
  savedOrigins = process.env.ALLOWED_ORIGINS;
});

afterEach(() => {
  if (savedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = savedOrigins;
});

// ── parseAllowedOrigins ───────────────────────────────────────────────────────

describe("parseAllowedOrigins", () => {
  it("T1: sem ALLOWED_ORIGINS → retorna lista de localhost por padrão", () => {
    const result = parseAllowedOrigins(undefined);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((o) => o.startsWith("http://localhost:"))).toBe(true);
  });

  it("T2: string vazia → retorna lista de localhost por padrão", () => {
    const result = parseAllowedOrigins("");
    expect(result.some((o) => o.startsWith("http://localhost:"))).toBe(true);
  });

  it("T3: string apenas com espaços → retorna lista de localhost por padrão", () => {
    const result = parseAllowedOrigins("   ");
    expect(result.some((o) => o.startsWith("http://localhost:"))).toBe(true);
  });

  it("T4: origem única → retorna array com um elemento", () => {
    const result = parseAllowedOrigins("https://app.example.com");
    expect(result).toEqual(["https://app.example.com"]);
  });

  it("T5: CSV com múltiplas origens → retorna array completo", () => {
    const result = parseAllowedOrigins(
      "https://app.example.com,https://staging.example.com"
    );
    expect(result).toEqual([
      "https://app.example.com",
      "https://staging.example.com",
    ]);
  });

  it("T6: CSV com espaços ao redor das vírgulas → trimado corretamente", () => {
    const result = parseAllowedOrigins(
      "https://app.example.com , https://staging.example.com"
    );
    expect(result).toEqual([
      "https://app.example.com",
      "https://staging.example.com",
    ]);
  });

  it("T7: quando ALLOWED_ORIGINS é definido, localhost NÃO é adicionado automaticamente", () => {
    const result = parseAllowedOrigins("https://app.example.com");
    expect(result.some((o) => o.includes("localhost"))).toBe(false);
  });

  it("T8: entradas vazias após split são filtradas", () => {
    const result = parseAllowedOrigins(
      "https://app.example.com,,https://staging.example.com"
    );
    expect(result).toEqual([
      "https://app.example.com",
      "https://staging.example.com",
    ]);
  });
});

// ── isOriginAllowed ───────────────────────────────────────────────────────────

describe("isOriginAllowed", () => {
  const allowed = ["https://app.example.com", "https://staging.example.com"];

  it("T9: origem na lista → permitida", () => {
    expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
  });

  it("T10: origem fora da lista → bloqueada", () => {
    expect(isOriginAllowed("https://evil.com", allowed)).toBe(false);
  });

  it("T11: subdomínio não explicitamente listado → bloqueado", () => {
    expect(isOriginAllowed("https://sub.app.example.com", allowed)).toBe(false);
  });

  it("T12: origin undefined → permitido (requisição servidor-a-servidor / curl)", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it("T13: origin string vazia → permitido (sem cabeçalho Origin)", () => {
    expect(isOriginAllowed("", allowed)).toBe(true);
  });

  it("T14: localhost permitido quando lista tem localhost", () => {
    const devList = ["http://localhost:3000", "http://localhost:5173"];
    expect(isOriginAllowed("http://localhost:3000", devList)).toBe(true);
  });

  it("T15: localhost bloqueado quando lista de produção não inclui localhost", () => {
    const prodList = ["https://app.example.com"];
    expect(isOriginAllowed("http://localhost:3000", prodList)).toBe(false);
  });

  it("T16: matching é case-sensitive — protocolo errado bloqueado", () => {
    // https vs http — diferentes origens no modelo de segurança do browser
    const list = ["https://app.example.com"];
    expect(isOriginAllowed("http://app.example.com", list)).toBe(false);
  });
});
