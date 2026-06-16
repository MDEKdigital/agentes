import { describe, it, expect } from "vitest";
import { normalizeHotmart } from "../hotmart";
import { normalizeStripe } from "../stripe";
import { normalizeMercadoPago } from "../mercadopago";
import { normalizeKiwify } from "../kiwify";
import { normalizeEduzz } from "../eduzz";
import { normalizePayload } from "../index";

// ─── Hotmart ─────────────────────────────────────────────────────────────────

describe("normalizeHotmart", () => {
  const base = {
    id: "evt-001",
    event: "PURCHASE_APPROVED",
    data: {
      buyer: { email: "joao@test.com", name: "João Silva" },
      product: { id: "prod-1", name: "Plano Pro" },
      purchase: {
        transaction: "TX123",
        subscription: {
          subscriber_code: "SUB-ABC",
          plan: { id: "plan-1", name: "Plano Anual" },
        },
        payment: { type: "CREDIT_CARD" },
        price: { value: 99.9 },
        offer: { code: "OFF-10" },
      },
    },
  };

  it("mapeia PURCHASE_APPROVED → subscription.activated", () => {
    const result = normalizeHotmart(base);
    expect(result.event_type).toBe("subscription.activated");
    expect(result.gateway).toBe("hotmart");
  });

  it("mapeia PURCHASE_COMPLETE → subscription.renewed", () => {
    const result = normalizeHotmart({ ...base, event: "PURCHASE_COMPLETE" });
    expect(result.event_type).toBe("subscription.renewed");
  });

  it("mapeia PURCHASE_CANCELLED → subscription.cancelled", () => {
    const result = normalizeHotmart({ ...base, event: "PURCHASE_CANCELLED" });
    expect(result.event_type).toBe("subscription.cancelled");
  });

  it("mapeia PURCHASE_REFUNDED → refund.processed", () => {
    const result = normalizeHotmart({ ...base, event: "PURCHASE_REFUNDED" });
    expect(result.event_type).toBe("refund.processed");
  });

  it("evento desconhecido → unknown", () => {
    const result = normalizeHotmart({ ...base, event: "SOMETHING_ELSE" });
    expect(result.event_type).toBe("unknown");
  });

  it("extrai customer corretamente", () => {
    const result = normalizeHotmart(base);
    expect(result.customer.email).toBe("joao@test.com");
    expect(result.customer.name).toBe("João Silva");
  });

  it("extrai gateway_event_id do id de topo", () => {
    const result = normalizeHotmart(base);
    expect(result.gateway_event_id).toBe("evt-001");
  });

  it("infere interval yearly a partir do nome do plano", () => {
    const result = normalizeHotmart(base);
    expect(result.subscription?.interval).toBe("yearly");
  });

  it("infere interval monthly quando nome não contém anual", () => {
    const monthly = { ...base, data: { ...base.data, purchase: { ...base.data.purchase, subscription: { ...base.data.purchase.subscription, plan: { id: "p2", name: "Plano Mensal" } } } } };
    const result = normalizeHotmart(monthly);
    expect(result.subscription?.interval).toBe("monthly");
  });

  it("converte amount para centavos", () => {
    const result = normalizeHotmart(base);
    expect(result.amount).toBe(9990);
  });

  it("sem subscriber_code → subscription undefined", () => {
    const noSub = { ...base, data: { ...base.data, purchase: { ...base.data.purchase, subscription: {} } } };
    const result = normalizeHotmart(noSub);
    expect(result.subscription).toBeUndefined();
  });
});

// ─── Stripe ──────────────────────────────────────────────────────────────────

describe("normalizeStripe", () => {
  const checkoutSession = {
    id: "evt_stripe_001",
    type: "checkout.session.completed",
    data: {
      object: {
        customer_email: "maria@test.com",
        customer_name: "Maria",
        customer: "cus_123",
        subscription: "sub_abc",
        currency: "brl",
        amount_total: 19900,
        metadata: { plan_slug: "pro", product_name: "Plano Pro" },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
      },
    },
  };

  it("mapeia checkout.session.completed → subscription.activated", () => {
    const result = normalizeStripe(checkoutSession);
    expect(result.event_type).toBe("subscription.activated");
    expect(result.gateway).toBe("stripe");
  });

  it("mapeia invoice.payment_succeeded → subscription.renewed", () => {
    const result = normalizeStripe({ ...checkoutSession, type: "invoice.payment_succeeded" });
    expect(result.event_type).toBe("subscription.renewed");
  });

  it("mapeia customer.subscription.deleted → subscription.cancelled", () => {
    const result = normalizeStripe({ ...checkoutSession, type: "customer.subscription.deleted" });
    expect(result.event_type).toBe("subscription.cancelled");
  });

  it("mapeia invoice.payment_failed → subscription.past_due", () => {
    const result = normalizeStripe({ ...checkoutSession, type: "invoice.payment_failed" });
    expect(result.event_type).toBe("subscription.past_due");
  });

  it("mapeia charge.refunded → refund.processed", () => {
    const result = normalizeStripe({ ...checkoutSession, type: "charge.refunded" });
    expect(result.event_type).toBe("refund.processed");
  });

  it("extrai customer email", () => {
    const result = normalizeStripe(checkoutSession);
    expect(result.customer.email).toBe("maria@test.com");
  });

  it("extrai subscription id", () => {
    const result = normalizeStripe(checkoutSession);
    expect(result.subscription?.gateway_subscription_id).toBe("sub_abc");
    expect(result.subscription?.gateway_customer_id).toBe("cus_123");
  });

  it("extrai plan_slug do metadata", () => {
    const result = normalizeStripe(checkoutSession);
    expect(result.product.plan_slug).toBe("pro");
  });

  it("converte currency para maiúsculas", () => {
    const result = normalizeStripe(checkoutSession);
    expect(result.currency).toBe("BRL");
  });

  it("sem subscription → subscription undefined", () => {
    const noSub = {
      ...checkoutSession,
      data: { object: { ...checkoutSession.data.object, subscription: "" } },
    };
    const result = normalizeStripe(noSub);
    expect(result.subscription).toBeUndefined();
  });

  it("evento desconhecido → unknown", () => {
    const result = normalizeStripe({ ...checkoutSession, type: "unknown.event" });
    expect(result.event_type).toBe("unknown");
  });
});

// ─── MercadoPago ─────────────────────────────────────────────────────────────

describe("normalizeMercadoPago", () => {
  it("payment.created → subscription.activated", () => {
    const result = normalizeMercadoPago({
      type: "payment",
      action: "payment.created",
      data: { id: "pay-123" },
    });
    expect(result.event_type).toBe("subscription.activated");
    expect(result.gateway).toBe("mercadopago");
  });

  it("payment status approved → subscription.activated", () => {
    const result = normalizeMercadoPago({ type: "payment", status: "approved", data: { id: "1" } });
    expect(result.event_type).toBe("subscription.activated");
  });

  it("subscription_preapproval authorized → subscription.renewed", () => {
    const result = normalizeMercadoPago({
      type: "subscription_preapproval",
      action: "updated",
      status: "authorized",
      data: { id: "2" },
    });
    expect(result.event_type).toBe("subscription.renewed");
  });

  it("subscription_preapproval cancelled → subscription.cancelled", () => {
    const result = normalizeMercadoPago({
      type: "subscription_preapproval",
      status: "cancelled",
      data: { id: "3" },
    });
    expect(result.event_type).toBe("subscription.cancelled");
  });

  it("extrai data.id corretamente", () => {
    const result = normalizeMercadoPago({ type: "payment", action: "payment.created", data: { id: "pay-999" } });
    expect(result.gateway_event_id).toBe("pay-999");
  });

  it("marca requires_api_fetch no metadata", () => {
    const result = normalizeMercadoPago({ type: "payment", action: "payment.created", data: { id: "1" } });
    expect(result.metadata?.requires_api_fetch).toBe(true);
  });

  it("campos de customer ficam vazios (requer API fetch)", () => {
    const result = normalizeMercadoPago({ type: "payment", action: "payment.created", data: { id: "1" } });
    expect(result.customer.email).toBe("");
    expect(result.customer.name).toBe("");
  });
});

// ─── Kiwify ──────────────────────────────────────────────────────────────────

describe("normalizeKiwify", () => {
  const base = {
    webhook_event_type: "order.approved",
    order_id: "ord-001",
    Customer: { email: "ana@test.com", full_name: "Ana Costa", CPF: "123.456.789-00" },
    Product: { product_id: "kiwi-prod-1", product_name: "Plano Kiwify" },
    Subscription: { id: "ksub-1", recurrence_type: "yearly" },
    order_total: 199.9,
  };

  it("mapeia order.approved → subscription.activated", () => {
    const result = normalizeKiwify(base);
    expect(result.event_type).toBe("subscription.activated");
    expect(result.gateway).toBe("kiwify");
  });

  it("mapeia subscription.charge_success → subscription.renewed", () => {
    const result = normalizeKiwify({ ...base, webhook_event_type: "subscription.charge_success" });
    expect(result.event_type).toBe("subscription.renewed");
  });

  it("mapeia subscription.cancelled → subscription.cancelled", () => {
    const result = normalizeKiwify({ ...base, webhook_event_type: "subscription.cancelled" });
    expect(result.event_type).toBe("subscription.cancelled");
  });

  it("mapeia order.refunded → refund.processed", () => {
    const result = normalizeKiwify({ ...base, webhook_event_type: "order.refunded" });
    expect(result.event_type).toBe("refund.processed");
  });

  it("extrai customer email", () => {
    const result = normalizeKiwify(base);
    expect(result.customer.email).toBe("ana@test.com");
    expect(result.customer.name).toBe("Ana Costa");
  });

  it("infere interval yearly", () => {
    const result = normalizeKiwify(base);
    expect(result.subscription?.interval).toBe("yearly");
  });

  it("converte amount para centavos", () => {
    const result = normalizeKiwify(base);
    expect(result.amount).toBe(19990);
  });

  it("sem subscription.id → subscription undefined", () => {
    const noSub = { ...base, Subscription: {} };
    const result = normalizeKiwify(noSub);
    expect(result.subscription).toBeUndefined();
  });
});

// ─── Eduzz ───────────────────────────────────────────────────────────────────

describe("normalizeEduzz", () => {
  const base = {
    trans_cod: "edz-001",
    trans_status: 5,
    cus_email: "carlos@test.com",
    cus_name: "Carlos",
    product_id: "prod-eduzz",
    product_name: "Eduzz Plano",
    trans_value: 49.9,
  };

  it("status 5 → subscription.activated", () => {
    const result = normalizeEduzz(base);
    expect(result.event_type).toBe("subscription.activated");
    expect(result.gateway).toBe("eduzz");
  });

  it("status 6 → refund.processed", () => {
    const result = normalizeEduzz({ ...base, trans_status: 6 });
    expect(result.event_type).toBe("refund.processed");
  });

  it("status 7 → refund.processed", () => {
    const result = normalizeEduzz({ ...base, trans_status: 7 });
    expect(result.event_type).toBe("refund.processed");
  });

  it("status 8 → refund.processed (chargeback)", () => {
    const result = normalizeEduzz({ ...base, trans_status: 8 });
    expect(result.event_type).toBe("refund.processed");
  });

  it("status 9 → subscription.cancelled", () => {
    const result = normalizeEduzz({ ...base, trans_status: 9 });
    expect(result.event_type).toBe("subscription.cancelled");
  });

  it("status 10 → subscription.cancelled (expirado)", () => {
    const result = normalizeEduzz({ ...base, trans_status: 10 });
    expect(result.event_type).toBe("subscription.cancelled");
  });

  it("status desconhecido → unknown", () => {
    const result = normalizeEduzz({ ...base, trans_status: 1 });
    expect(result.event_type).toBe("unknown");
  });

  it("extrai customer email", () => {
    const result = normalizeEduzz(base);
    expect(result.customer.email).toBe("carlos@test.com");
  });

  it("converte trans_value para centavos", () => {
    const result = normalizeEduzz(base);
    expect(result.amount).toBe(4990);
  });

  it("extrai gateway_event_id de trans_cod", () => {
    const result = normalizeEduzz(base);
    expect(result.gateway_event_id).toBe("edz-001");
  });
});

// ─── normalizePayload dispatcher ─────────────────────────────────────────────

describe("normalizePayload", () => {
  it("despacha para hotmart", () => {
    const result = normalizePayload("hotmart", { event: "PURCHASE_APPROVED", data: {} });
    expect(result.gateway).toBe("hotmart");
  });

  it("despacha para stripe", () => {
    const result = normalizePayload("stripe", { type: "checkout.session.completed", data: { object: {} } });
    expect(result.gateway).toBe("stripe");
  });

  it("despacha para mercadopago", () => {
    const result = normalizePayload("mercadopago", { type: "payment", action: "payment.created", data: { id: "1" } });
    expect(result.gateway).toBe("mercadopago");
  });

  it("despacha para kiwify", () => {
    const result = normalizePayload("kiwify", { webhook_event_type: "order.approved" });
    expect(result.gateway).toBe("kiwify");
  });

  it("despacha para eduzz", () => {
    const result = normalizePayload("eduzz", { trans_status: 5 });
    expect(result.gateway).toBe("eduzz");
  });

  it("gateway desconhecido retorna undefined (exaustividade garantida pelo TypeScript)", () => {
    // The switch has no default; TypeScript enforces exhaustiveness at compile time.
    const result = normalizePayload("unknown" as "hotmart", {});
    expect(result).toBeUndefined();
  });
});
