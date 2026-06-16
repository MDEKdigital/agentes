import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac, createHash } from "node:crypto";
import {
  validateHotmartSignature,
  validateStripeSignature,
  validateMercadoPagoSignature,
  validateKiwifySignature,
  validateEduzzSignature,
} from "../billing-webhook-signature";

// Returns `any` so we don't have to satisfy the full FastifyRequest interface in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(headers: Record<string, string> = {}, rawBody = "", query: Record<string, string> = {}): any {
  return { headers, rawBody, query, log: { warn: () => {} } };
}

const ENV_KEYS = [
  "HOTMART_WEBHOOK_TOKEN",
  "STRIPE_WEBHOOK_SECRET",
  "MERCADOPAGO_WEBHOOK_SECRET",
  "KIWIFY_WEBHOOK_SECRET",
  "EDUZZ_WEBHOOK_SECRET",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ─── Hotmart ─────────────────────────────────────────────────────────────────

describe("validateHotmartSignature", () => {
  it("retorna inválido quando env não está configurado", () => {
    delete process.env.HOTMART_WEBHOOK_TOKEN;
    const result = validateHotmartSignature(req({ "x-hotmart-webhook-token": "tok" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not configured/);
  });

  it("retorna inválido quando header está ausente", () => {
    process.env.HOTMART_WEBHOOK_TOKEN = "secret";
    const result = validateHotmartSignature(req({}));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it("retorna inválido com token errado", () => {
    process.env.HOTMART_WEBHOOK_TOKEN = "secret";
    const result = validateHotmartSignature(req({ "x-hotmart-webhook-token": "wrong" }));
    expect(result.valid).toBe(false);
  });

  it("retorna válido com token correto", () => {
    process.env.HOTMART_WEBHOOK_TOKEN = "my-secret";
    const result = validateHotmartSignature(req({ "x-hotmart-webhook-token": "my-secret" }));
    expect(result.valid).toBe(true);
  });
});

// ─── Stripe ──────────────────────────────────────────────────────────────────

describe("validateStripeSignature", () => {
  const secret = "whsec_test123";

  function makeStripeHeader(ts: number, body: string) {
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    return `t=${ts},v1=${sig}`;
  }

  it("retorna inválido quando env não está configurado", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const ts = Math.floor(Date.now() / 1000);
    const result = validateStripeSignature(req({ "stripe-signature": `t=${ts},v1=abc` }));
    expect(result.valid).toBe(false);
  });

  it("retorna inválido quando header está ausente", () => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const result = validateStripeSignature(req({}));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it("retorna inválido com formato inválido de Stripe-Signature", () => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const result = validateStripeSignature(req({ "stripe-signature": "malformed" }));
    expect(result.valid).toBe(false);
  });

  it("retorna inválido quando timestamp é antigo (>5min)", () => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const oldTs = Math.floor(Date.now() / 1000) - 400;
    const body = '{"type":"test"}';
    const header = makeStripeHeader(oldTs, body);
    const result = validateStripeSignature(req({ "stripe-signature": header }, body));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too old/);
  });

  it("retorna inválido com assinatura errada", () => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"type":"test"}';
    const result = validateStripeSignature(req({ "stripe-signature": `t=${ts},v1=wrongsig` }, body));
    expect(result.valid).toBe(false);
  });

  it("retorna válido com assinatura correta e timestamp recente", () => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"type":"checkout.session.completed"}';
    const header = makeStripeHeader(ts, body);
    const result = validateStripeSignature(req({ "stripe-signature": header }, body));
    expect(result.valid).toBe(true);
  });
});

// ─── MercadoPago ─────────────────────────────────────────────────────────────

describe("validateMercadoPagoSignature", () => {
  const secret = "mp-secret";

  function makeMP(dataId: string, xRequestId: string, ts: string) {
    const toSign = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const sig = createHmac("sha256", secret).update(toSign).digest("hex");
    return `ts=${ts},v1=${sig}`;
  }

  it("retorna inválido quando env não está configurado", () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const result = validateMercadoPagoSignature(req({ "x-signature": "ts=1,v1=abc" }));
    expect(result.valid).toBe(false);
  });

  it("retorna inválido quando header x-signature está ausente", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    const result = validateMercadoPagoSignature(req({}));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it("retorna inválido com assinatura errada", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    const result = validateMercadoPagoSignature(
      req({ "x-signature": "ts=1,v1=wrong", "x-request-id": "req-1" }, "", { "data.id": "123" })
    );
    expect(result.valid).toBe(false);
  });

  it("retorna válido com assinatura correta", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    const header = makeMP("99999", "req-abc", "1700000000");
    const result = validateMercadoPagoSignature(
      req({ "x-signature": header, "x-request-id": "req-abc" }, "", { "data.id": "99999" })
    );
    expect(result.valid).toBe(true);
  });
});

// ─── Kiwify ──────────────────────────────────────────────────────────────────

describe("validateKiwifySignature", () => {
  const secret = "kiwify-secret";

  it("retorna inválido quando env não está configurado", () => {
    delete process.env.KIWIFY_WEBHOOK_SECRET;
    const result = validateKiwifySignature(req({ "x-kiwify-event-token": "tok" }));
    expect(result.valid).toBe(false);
  });

  it("retorna inválido quando header está ausente", () => {
    process.env.KIWIFY_WEBHOOK_SECRET = secret;
    const result = validateKiwifySignature(req({}));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it("retorna inválido com assinatura errada", () => {
    process.env.KIWIFY_WEBHOOK_SECRET = secret;
    const body = '{"webhook_event_type":"order.approved"}';
    const result = validateKiwifySignature(req({ "x-kiwify-event-token": "wrong" }, body));
    expect(result.valid).toBe(false);
  });

  it("retorna válido com assinatura correta", () => {
    process.env.KIWIFY_WEBHOOK_SECRET = secret;
    const body = '{"webhook_event_type":"order.approved"}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const result = validateKiwifySignature(req({ "x-kiwify-event-token": sig }, body));
    expect(result.valid).toBe(true);
  });
});

// ─── Eduzz ───────────────────────────────────────────────────────────────────

describe("validateEduzzSignature", () => {
  const secret = "eduzz-secret";

  it("retorna inválido quando env não está configurado", () => {
    delete process.env.EDUZZ_WEBHOOK_SECRET;
    const result = validateEduzzSignature(req({ "eduzz-token": "tok" }));
    expect(result.valid).toBe(false);
  });

  it("retorna inválido quando header está ausente", () => {
    process.env.EDUZZ_WEBHOOK_SECRET = secret;
    const result = validateEduzzSignature(req({}));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Missing/);
  });

  it("retorna inválido com hash errado", () => {
    process.env.EDUZZ_WEBHOOK_SECRET = secret;
    const body = '{"trans_cod":"12345"}';
    const result = validateEduzzSignature(req({ "eduzz-token": "wrong" }, body));
    expect(result.valid).toBe(false);
  });

  it("retorna válido com MD5 correto", () => {
    process.env.EDUZZ_WEBHOOK_SECRET = secret;
    const body = '{"trans_cod":"12345"}';
    const expected = createHash("md5").update(body + secret).digest("hex").toLowerCase();
    const result = validateEduzzSignature(req({ "eduzz-token": expected }, body));
    expect(result.valid).toBe(true);
  });
});
