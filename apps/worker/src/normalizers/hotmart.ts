import type { BillingEventType, BillingInterval, NormalizedBillingEvent } from "@aula-agente/shared";

const EVENT_TYPE_MAP: Record<string, BillingEventType> = {
  PURCHASE_APPROVED: "subscription.activated",
  PURCHASE_COMPLETE: "subscription.renewed",
  PURCHASE_CANCELLED: "subscription.cancelled",
  PURCHASE_REFUNDED: "refund.processed",
  PURCHASE_CHARGEBACK: "refund.processed",
};

function classifyInterval(planName: string): BillingInterval {
  const lower = planName.toLowerCase();
  if (lower.includes("anual") || lower.includes("yearly") || lower.includes("annual")) return "yearly";
  if (lower.includes("vitalic") || lower.includes("lifetime")) return "lifetime";
  return "monthly";
}

export function normalizeHotmart(raw: Record<string, unknown>): NormalizedBillingEvent {
  const event = raw.event as string | undefined;
  const data = (raw.data ?? {}) as Record<string, unknown>;
  const buyer = (data.buyer ?? {}) as Record<string, unknown>;
  const product = (data.product ?? {}) as Record<string, unknown>;
  const purchase = (data.purchase ?? {}) as Record<string, unknown>;
  const subscription = (purchase.subscription ?? {}) as Record<string, unknown>;
  const plan = (subscription.plan ?? {}) as Record<string, unknown>;
  const payment = (purchase.payment ?? {}) as Record<string, unknown>;
  const price = (purchase.price ?? {}) as Record<string, unknown>;

  const eventType: BillingEventType = EVENT_TYPE_MAP[event ?? ""] ?? "unknown";
  const planName = String(plan.name ?? product.name ?? "");
  const subscriberCode = String(subscription.subscriber_code ?? "");

  return {
    event_type: eventType,
    gateway: "hotmart",
    gateway_event_id: String(raw.id ?? purchase.transaction ?? ""),
    customer: {
      email: String(buyer.email ?? ""),
      name: String(buyer.name ?? ""),
      document: buyer.document ? String(buyer.document) : undefined,
      phone: buyer.checkout_phone ? String(buyer.checkout_phone) : undefined,
    },
    product: {
      gateway_product_id: String(product.id ?? ""),
      gateway_plan_id: plan.id ? String(plan.id) : undefined,
      name: planName || String(product.name ?? ""),
    },
    subscription: subscriberCode
      ? {
          gateway_subscription_id: subscriberCode,
          interval: classifyInterval(planName),
        }
      : undefined,
    amount: typeof price.value === "number" ? Math.round(price.value * 100) : undefined,
    currency: "BRL",
    metadata: {
      transaction: purchase.transaction,
      payment_type: payment.type,
      offer_code: (purchase.offer as Record<string, unknown> | undefined)?.code,
    },
  };
}
