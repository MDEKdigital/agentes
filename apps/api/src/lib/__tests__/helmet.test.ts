import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import { helmetOptions } from "../helmet";

// Cria uma app Fastify mínima com as mesmas opções de helmet usadas em produção.
// fastify.inject() faz requisições in-process — sem servidor HTTP, sem side-effects.
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(helmet, helmetOptions);
  app.get("/", async () => ({ ok: true }));
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

// ── T1 — helmet registrado ────────────────────────────────────────────────────

it("T1: helmet registrado — resposta contém ao menos um security header", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  // X-Content-Type-Options é o header mais básico que helmet sempre seta
  expect(res.headers["x-content-type-options"]).toBeDefined();
});

// ── T2 — Content-Security-Policy ─────────────────────────────────────────────

it("T2: CSP presente com default-src 'self'", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  const csp = res.headers["content-security-policy"] as string | undefined;
  expect(csp).toBeDefined();
  expect(csp).toContain("default-src 'self'");
});

it("T2b: CSP inclui connect-src para permitir chamadas HTTPS à API", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  const csp = res.headers["content-security-policy"] as string;
  expect(csp).toContain("connect-src");
  expect(csp).toContain("https:");
});

// ── T3 — frame-ancestors ─────────────────────────────────────────────────────

it("T3: CSP contém frame-ancestors 'none' (anti-clickjacking)", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  const csp = res.headers["content-security-policy"] as string;
  expect(csp).toContain("frame-ancestors 'none'");
});

// ── T4 — X-Content-Type-Options ──────────────────────────────────────────────

it("T4: X-Content-Type-Options = nosniff (previne MIME sniffing)", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
});

// ── T5 — Referrer-Policy ─────────────────────────────────────────────────────

it("T5: Referrer-Policy presente", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.headers["referrer-policy"]).toBeDefined();
  expect(res.headers["referrer-policy"]).not.toBe("");
});

// ── T6 — Strict-Transport-Security ───────────────────────────────────────────

it("T6: Strict-Transport-Security (HSTS) presente com max-age", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  const hsts = res.headers["strict-transport-security"] as string | undefined;
  expect(hsts).toBeDefined();
  expect(hsts).toMatch(/max-age=\d+/);
});

// ── T6b — Cross-Origin-Resource-Policy ───────────────────────────────────────

it("T6b: Cross-Origin-Resource-Policy permite acesso cross-origin (API pública)", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  const corp = res.headers["cross-origin-resource-policy"] as string | undefined;
  expect(corp).toBe("cross-origin");
});

// ── T7 — sem regressão ───────────────────────────────────────────────────────

it("T7: helmet não quebra rota existente — body JSON intacto", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true });
});

it("T7b: helmet não quebra rota com 404 — status correto", async () => {
  const res = await app.inject({ method: "GET", url: "/nao-existe" });
  expect(res.statusCode).toBe(404);
  // headers de segurança devem estar presentes mesmo em erros
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
});
