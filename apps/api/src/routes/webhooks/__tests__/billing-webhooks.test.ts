import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockTryInsertBillingEvent,
  mockEnqueueBillingOnboarding,
  mockValidateHotmart,
  mockValidateStripe,
  mockValidateMercadoPago,
  mockValidateKiwify,
  mockValidateEduzz,
} = vi.hoisted(() => ({
  mockTryInsertBillingEvent: vi.fn(),
  mockEnqueueBillingOnboarding: vi.fn(),
  mockValidateHotmart: vi.fn(),
  mockValidateStripe: vi.fn(),
  mockValidateMercadoPago: vi.fn(),
  mockValidateKiwify: vi.fn(),
  mockValidateEduzz: vi.fn(),
}));

vi.mock("@aula-agente/database", () => ({
  getAdminClient: vi.fn(() => ({})),
  tryInsertBillingEvent: mockTryInsertBillingEvent,
}));

vi.mock("../../../lib/queue", () => ({
  enqueueBillingOnboarding: mockEnqueueBillingOnboarding,
}));

vi.mock("../../../lib/billing-webhook-signature", () => ({
  validateHotmartSignature: mockValidateHotmart,
  validateStripeSignature: mockValidateStripe,
  validateMercadoPagoSignature: mockValidateMercadoPago,
  validateKiwifySignature: mockValidateKiwify,
  validateEduzzSignature: mockValidateEduzz,
}));

import billingWebhookRoutes from "../billing/index";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(billingWebhookRoutes);
  return app;
}

const BILLING_EVENT = { id: "be-uuid-001" };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: valid signature
  mockValidateHotmart.mockReturnValue({ valid: true });
  mockValidateStripe.mockReturnValue({ valid: true });
  mockValidateMercadoPago.mockReturnValue({ valid: true });
  mockValidateKiwify.mockReturnValue({ valid: true });
  mockValidateEduzz.mockReturnValue({ valid: true });
  // Default: new event inserted
  mockTryInsertBillingEvent.mockResolvedValue(BILLING_EVENT);
  mockEnqueueBillingOnboarding.mockResolvedValue(undefined);
});

// ─── Hotmart ─────────────────────────────────────────────────────────────────

describe("POST /webhooks/hotmart", () => {
  it("retorna 401 quando assinatura inválida", async () => {
    mockValidateHotmart.mockReturnValue({ valid: false, reason: "bad sig" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/hotmart",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-1", event: "PURCHASE_APPROVED" }),
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/signature/);
  });

  it("retorna 400 quando event ID está ausente", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/hotmart",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "PURCHASE_APPROVED" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("retorna 200 ok e enfileira job no caminho feliz", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/hotmart",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-1", event: "PURCHASE_APPROVED" }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true });
    expect(mockEnqueueBillingOnboarding).toHaveBeenCalledWith({ billingEventId: "be-uuid-001" });
  });

  it("retorna 200 skipped quando evento duplicado (tryInsert retorna null)", async () => {
    mockTryInsertBillingEvent.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/hotmart",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-dup", event: "PURCHASE_APPROVED" }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("duplicate");
    expect(mockEnqueueBillingOnboarding).not.toHaveBeenCalled();
  });

  it("insere billing_event com campos corretos", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/hotmart",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-1", event: "PURCHASE_APPROVED" }),
    });
    expect(mockTryInsertBillingEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        gateway: "hotmart",
        idempotency_key: "hotmart:evt-1",
        gateway_event_id: "evt-1",
      })
    );
  });

  it("extrai event ID do purchase.transaction como fallback", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/hotmart",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "PURCHASE_APPROVED",
        data: { purchase: { transaction: "TX-FALLBACK" } },
      }),
    });
    expect(mockTryInsertBillingEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ gateway_event_id: "TX-FALLBACK" })
    );
  });
});

// ─── Stripe ──────────────────────────────────────────────────────────────────

describe("POST /webhooks/stripe", () => {
  it("retorna 401 quando assinatura inválida", async () => {
    mockValidateStripe.mockReturnValue({ valid: false, reason: "bad sig" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt_stripe_1", type: "checkout.session.completed" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("retorna 400 quando id está ausente", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("retorna 200 ok no caminho feliz", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt_stripe_1", type: "checkout.session.completed" }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueueBillingOnboarding).toHaveBeenCalledWith({ billingEventId: "be-uuid-001" });
  });

  it("retorna 200 skipped em duplicata", async () => {
    mockTryInsertBillingEvent.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt_dup", type: "checkout.session.completed" }),
    });
    expect(JSON.parse(res.body).skipped).toBe("duplicate");
  });

  it("usa idempotency_key prefixado com stripe:", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt_stripe_1", type: "checkout.session.completed" }),
    });
    expect(mockTryInsertBillingEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotency_key: "stripe:evt_stripe_1" })
    );
  });
});

// ─── MercadoPago ─────────────────────────────────────────────────────────────

describe("POST /webhooks/mercadopago", () => {
  it("retorna 401 quando assinatura inválida", async () => {
    mockValidateMercadoPago.mockReturnValue({ valid: false, reason: "bad sig" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/mercadopago",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "payment", data: { id: "mp-1" } }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("retorna 200 no caminho feliz", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/mercadopago",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "payment", data: { id: "mp-1" } }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockEnqueueBillingOnboarding).toHaveBeenCalled();
  });
});

// ─── Kiwify ──────────────────────────────────────────────────────────────────

describe("POST /webhooks/kiwify", () => {
  it("retorna 401 quando assinatura inválida", async () => {
    mockValidateKiwify.mockReturnValue({ valid: false, reason: "bad sig" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/kiwify",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_id: "ord-1", webhook_event_type: "order.approved" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("retorna 400 quando event ID está ausente", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/kiwify",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhook_event_type: "order.approved" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("retorna 200 no caminho feliz", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/kiwify",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_id: "ord-1", webhook_event_type: "order.approved" }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockTryInsertBillingEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ gateway: "kiwify", idempotency_key: "kiwify:ord-1" })
    );
  });
});

// ─── Eduzz ───────────────────────────────────────────────────────────────────

describe("POST /webhooks/eduzz", () => {
  it("retorna 401 quando assinatura inválida", async () => {
    mockValidateEduzz.mockReturnValue({ valid: false, reason: "bad sig" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/eduzz",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trans_cod: "edz-1", trans_status: 5 }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("retorna 400 quando trans_cod está ausente", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/eduzz",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trans_status: 5 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("retorna 200 no caminho feliz", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/eduzz",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trans_cod: "edz-1", trans_status: 5 }),
    });
    expect(res.statusCode).toBe(200);
    expect(mockTryInsertBillingEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ gateway: "eduzz", idempotency_key: "eduzz:edz-1" })
    );
    expect(mockEnqueueBillingOnboarding).toHaveBeenCalledWith({ billingEventId: "be-uuid-001" });
  });

  it("retorna 200 skipped em duplicata", async () => {
    mockTryInsertBillingEvent.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/eduzz",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trans_cod: "edz-dup", trans_status: 5 }),
    });
    expect(JSON.parse(res.body).skipped).toBe("duplicate");
    expect(mockEnqueueBillingOnboarding).not.toHaveBeenCalled();
  });
});
