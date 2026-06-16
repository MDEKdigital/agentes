import type { BillingEventType, BillingInterval, NormalizedBillingEvent } from "@aula-agente/shared";

const EVENT_TYPE_MAP: Record<string, BillingEventType> = {
  "order.approved": "subscription.activated",
  "subscription.charge_success": "subscription.renewed",
  "subscription.cancelled": "subscription.cancelled",
  "order.refunded": "refund.processed",
};

function classifyInterval(recurrenceType: string | undefined): BillingInterval {
  if (recurrenceType === "yearly" || recurrenceType === "annual") return "yearly";
  if (recurrenceType === "lifetime") return "lifetime";
  return "monthly";
}

export function normalizeKiwify(raw: Record<string, unknown>): NormalizedBillingEvent {
  const webhookEventType = raw.webhook_event_type as string | undefined;
  const eventType: BillingEventType = EVENT_TYPE_MAP[webhookEventType ?? ""] ?? "unknown";

  const customer = (raw.Customer ?? raw.customer ?? {}) as Record<string, unknown>;
  const product = (raw.Product ?? raw.product ?? {}) as Record<string, unknown>;
  const subscription = (raw.Subscription ?? raw.subscription ?? {}) as Record<string, unknown>;
  const order = (raw.order ?? {}) as Record<string, unknown>;

  const amountRaw = raw.order_total ?? order.amount;
  const amount =
    typeof amountRaw === "number" ? Math.round(amountRaw * 100) : undefined;

  return {
    event_type: eventType,
    gateway: "kiwify",
    gateway_event_id: String(raw.order_id ?? raw.id ?? ""),
    customer: {
      email: String(customer.email ?? ""),
      name: String(customer.full_name ?? customer.name ?? ""),
      document: customer.CPF ? String(customer.CPF) : undefined,
      phone: customer.mobile ?? customer.phone ? String(customer.mobile ?? customer.phone) : undefined,
    },
    product: {
      gateway_product_id: String(product.product_id ?? product.id ?? ""),
      name: String(product.product_name ?? product.name ?? ""),
    },
    subscription: subscription.id
      ? {
          gateway_subscription_id: String(subscription.id),
          interval: classifyInterval(subscription.recurrence_type as string | undefined),
          current_period_start: subscription.current_period_start as string | undefined,
          current_period_end: subscription.current_period_end as string | undefined,
        }
      : undefined,
    amount,
    currency: "BRL",
    metadata: { webhook_event_type: webhookEventType },
  };
}
