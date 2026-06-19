import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimitPlugin from "@fastify/rate-limit";
import { parseRateLimitConfig, type RateLimitTiers } from "../rate-limit";

// ── helpers ───────────────────────────────────────────────────────────────────

async function buildTestApp(
  tiers: RateLimitTiers,
  overrides: { webhookMax?: number; messagesMax?: number; sensitiveMax?: number } = {}
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(rateLimitPlugin, {
    global: true,
    max: tiers.defaultMax,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip ?? "test",
  });

  // DEFAULT tier route
  app.get("/api/resource", async () => ({ tier: "default" }));

  // WEBHOOK tier
  app.post("/webhooks/test", {
    config: { rateLimit: { max: overrides.webhookMax ?? tiers.webhookMax, timeWindow: "1 minute" } },
    handler: async () => ({ tier: "webhook" }),
  });

  // MESSAGES tier
  app.post("/messages/send", {
    config: { rateLimit: { max: overrides.messagesMax ?? tiers.messagesMax, timeWindow: "1 minute" } },
    handler: async () => ({ tier: "messages" }),
  });

  // SENSITIVE tier
  app.post("/organizations/test/invitations", {
    config: { rateLimit: { max: overrides.sensitiveMax ?? tiers.sensitiveMax, timeWindow: "1 minute" } },
    handler: async () => ({ tier: "sensitive" }),
  });

  await app.ready();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 – T7: parseRateLimitConfig — unit tests (sem Fastify)
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRateLimitConfig", () => {
  it("T1: retorna defaults quando nenhuma env está definida", () => {
    const cfg = parseRateLimitConfig({});
    expect(cfg.defaultMax).toBe(100);
    expect(cfg.webhookMax).toBe(120);
    expect(cfg.messagesMax).toBe(30);
    expect(cfg.sensitiveMax).toBe(10);
  });

  it("T2: RATE_LIMIT_DEFAULT sobrescreve o padrão", () => {
    const cfg = parseRateLimitConfig({ RATE_LIMIT_DEFAULT: "50" });
    expect(cfg.defaultMax).toBe(50);
    expect(cfg.webhookMax).toBe(120); // inalterado
  });

  it("T3: RATE_LIMIT_WEBHOOK sobrescreve apenas o webhook", () => {
    const cfg = parseRateLimitConfig({ RATE_LIMIT_WEBHOOK: "200" });
    expect(cfg.webhookMax).toBe(200);
    expect(cfg.defaultMax).toBe(100);
    expect(cfg.messagesMax).toBe(30);
  });

  it("T4: RATE_LIMIT_MESSAGES sobrescreve apenas messages", () => {
    const cfg = parseRateLimitConfig({ RATE_LIMIT_MESSAGES: "15" });
    expect(cfg.messagesMax).toBe(15);
    expect(cfg.defaultMax).toBe(100);
  });

  it("T5: RATE_LIMIT_SENSITIVE sobrescreve apenas sensitive", () => {
    const cfg = parseRateLimitConfig({ RATE_LIMIT_SENSITIVE: "5" });
    expect(cfg.sensitiveMax).toBe(5);
    expect(cfg.defaultMax).toBe(100);
  });

  it("T6: valor NaN cai no default do tier", () => {
    const cfg = parseRateLimitConfig({ RATE_LIMIT_DEFAULT: "abc" });
    expect(cfg.defaultMax).toBe(100);
  });

  it("T7: valor negativo cai no default do tier", () => {
    const cfg = parseRateLimitConfig({ RATE_LIMIT_DEFAULT: "-5" });
    expect(cfg.defaultMax).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 – T17: integration tests com fastify.inject()
// Cada grupo usa max=1 para forçar 429 na 2ª request sem precisar esperar.
// ─────────────────────────────────────────────────────────────────────────────

describe("rate-limit — integração", () => {
  // T8: plugin registrado
  it("T8: @fastify/rate-limit está registrado — headers RateLimit presentes na resposta", async () => {
    const tiers: RateLimitTiers = { defaultMax: 5, webhookMax: 10, messagesMax: 5, sensitiveMax: 5 };
    const app = await buildTestApp(tiers);
    try {
      const res = await app.inject({ method: "GET", url: "/api/resource" });
      // @fastify/rate-limit injeta o header x-ratelimit-limit
      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    } finally {
      await app.close();
    }
  });

  // T9: rota genérica abaixo do limite → 200
  it("T9: DEFAULT — primeira request retorna 200", async () => {
    const tiers: RateLimitTiers = { defaultMax: 5, webhookMax: 10, messagesMax: 5, sensitiveMax: 5 };
    const app = await buildTestApp(tiers);
    try {
      const res = await app.inject({ method: "GET", url: "/api/resource" });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  // T10: DEFAULT — duas requests dentro do limite → ambas 200
  it("T10: DEFAULT — duas requests dentro do limite retornam 200", async () => {
    const tiers: RateLimitTiers = { defaultMax: 2, webhookMax: 10, messagesMax: 5, sensitiveMax: 5 };
    const app = await buildTestApp(tiers);
    try {
      const r1 = await app.inject({ method: "GET", url: "/api/resource" });
      const r2 = await app.inject({ method: "GET", url: "/api/resource" });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  // T11: DEFAULT — excede limite → 429
  it("T11: DEFAULT — segunda request com max=1 retorna 429", async () => {
    const tiers: RateLimitTiers = { defaultMax: 1, webhookMax: 5, messagesMax: 5, sensitiveMax: 5 };
    const app = await buildTestApp(tiers);
    try {
      await app.inject({ method: "GET", url: "/api/resource" });
      const r2 = await app.inject({ method: "GET", url: "/api/resource" });
      expect(r2.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  // T12: WEBHOOK — limite maior que DEFAULT, 2 requests dentro do webhook limit → 200
  it("T12: WEBHOOK — limite maior que DEFAULT permite mais requests (webhook max=2, default max=1)", async () => {
    const tiers: RateLimitTiers = { defaultMax: 1, webhookMax: 2, messagesMax: 5, sensitiveMax: 5 };
    const app = await buildTestApp(tiers);
    try {
      const r1 = await app.inject({ method: "POST", url: "/webhooks/test" });
      const r2 = await app.inject({ method: "POST", url: "/webhooks/test" });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  // T13: WEBHOOK — excede o limite do tier → 429
  it("T13: WEBHOOK — terceira request com max=2 retorna 429", async () => {
    const tiers: RateLimitTiers = { defaultMax: 10, webhookMax: 2, messagesMax: 10, sensitiveMax: 10 };
    const app = await buildTestApp(tiers);
    try {
      await app.inject({ method: "POST", url: "/webhooks/test" });
      await app.inject({ method: "POST", url: "/webhooks/test" });
      const r3 = await app.inject({ method: "POST", url: "/webhooks/test" });
      expect(r3.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  // T14: MESSAGES — request dentro do limite → 200
  it("T14: MESSAGES — primeira request retorna 200", async () => {
    const tiers: RateLimitTiers = { defaultMax: 5, webhookMax: 10, messagesMax: 3, sensitiveMax: 5 };
    const app = await buildTestApp(tiers);
    try {
      const res = await app.inject({ method: "POST", url: "/messages/send" });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  // T15: MESSAGES — excede limite → 429
  it("T15: MESSAGES — segunda request com max=1 retorna 429", async () => {
    const tiers: RateLimitTiers = { defaultMax: 10, webhookMax: 10, messagesMax: 1, sensitiveMax: 10 };
    const app = await buildTestApp(tiers);
    try {
      await app.inject({ method: "POST", url: "/messages/send" });
      const r2 = await app.inject({ method: "POST", url: "/messages/send" });
      expect(r2.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  // T16: SENSITIVE — request dentro do limite → 200
  it("T16: SENSITIVE — primeira request retorna 200", async () => {
    const tiers: RateLimitTiers = { defaultMax: 5, webhookMax: 10, messagesMax: 5, sensitiveMax: 3 };
    const app = await buildTestApp(tiers);
    try {
      const res = await app.inject({ method: "POST", url: "/organizations/test/invitations" });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  // T17: SENSITIVE — excede limite → 429
  it("T17: SENSITIVE — segunda request com max=1 retorna 429", async () => {
    const tiers: RateLimitTiers = { defaultMax: 10, webhookMax: 10, messagesMax: 10, sensitiveMax: 1 };
    const app = await buildTestApp(tiers);
    try {
      await app.inject({ method: "POST", url: "/organizations/test/invitations" });
      const r2 = await app.inject({ method: "POST", url: "/organizations/test/invitations" });
      expect(r2.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
