import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

// webhook-verify reads env at call time after V8 fix; beforeEach sets it per test.
import { webhookVerifyMiddleware } from "../webhook-verify";

const SECRET = "test-webhook-secret-abc";

function buildApp() {
  const app = Fastify({ logger: false });
  app.get("/ping", { preHandler: [webhookVerifyMiddleware] }, async () => ({ ok: true }));
  return app;
}

describe("webhookVerifyMiddleware — V8 (caminho uniforme de validacao)", () => {
  beforeEach(() => { process.env.WEBHOOK_SECRET = SECRET; });
  afterEach(() => { delete process.env.WEBHOOK_SECRET; });

  it("segredo correto via apikey → 200", async () => {
    const res = await buildApp().inject({
      method: "GET",
      url: "/ping",
      headers: { apikey: SECRET },
    });
    expect(res.statusCode).toBe(200);
  });

  it("segredo correto via x-api-key → 200", async () => {
    const res = await buildApp().inject({
      method: "GET",
      url: "/ping",
      headers: { "x-api-key": SECRET },
    });
    expect(res.statusCode).toBe(200);
  });

  it("segredo incorreto → 401", async () => {
    const res = await buildApp().inject({
      method: "GET",
      url: "/ping",
      headers: { apikey: "wrong-value" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("segredo com comprimento menor → 401 sem crash", async () => {
    const res = await buildApp().inject({
      method: "GET",
      url: "/ping",
      headers: { apikey: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("segredo com comprimento maior → 401 sem crash", async () => {
    const res = await buildApp().inject({
      method: "GET",
      url: "/ping",
      headers: { apikey: SECRET + "-extra-chars-appended" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("header ausente → 401", async () => {
    const res = await buildApp().inject({ method: "GET", url: "/ping" });
    expect(res.statusCode).toBe(401);
  });

  it("WEBHOOK_SECRET nao configurado → 503", async () => {
    delete process.env.WEBHOOK_SECRET;
    const res = await buildApp().inject({
      method: "GET",
      url: "/ping",
      headers: { apikey: SECRET },
    });
    expect(res.statusCode).toBe(503);
  });
});
