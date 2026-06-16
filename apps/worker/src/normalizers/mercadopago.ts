import type { BillingEventType, NormalizedBillingEvent } from "@aula-agente/shared";

// MercadoPago webhook is a notification-only payload — full details require API fetch.
// We extract what's available and mark the rest for the worker to resolve.

function classifyEventType(
  type: string | undefined,
  action: string | undefined,
  status: string | undefined
): BillingEventType {
  if (type === "payment") {
    if (action === "payment.created" || status === "approved") return "subscription.activated";
    if (status === "refunded") return "refund.processed";
    if (status === "cancelled") return "subscription.cancelled";
    if (status === "in_process" || status === "pending") return "unknown";
  }
  if (type === "subscription_preapproval") {
    if (action === "updated" || status === "authorized") return "subscription.renewed";
    if (status === "cancelled") return "subscription.cancelled";
    if (status === "paused") return "subscription.past_due";
  }
  return "unknown";
}

export function normalizeMercadoPago(raw: Record<string, unknown>): NormalizedBillingEvent {
  const type = raw.type as string | undefined;
  const action = raw.action as string | undefined;
  const dataId = String((raw.data as Record<string, unknown> | undefined)?.id ?? raw.id ?? "");

  // MercadoPago notification payload is minimal — most fields need API fetch
  const status = raw.status as string | undefined;
  const eventType = classifyEventType(type, action, status);

  return {
    event_type: eventType,
    gateway: "mercadopago",
    gateway_event_id: dataId,
    customer: {
      email: "",   // requires API fetch
      name: "",    // requires API fetch
    },
    product: {
      gateway_product_id: "",  // requires API fetch
      name: "",
    },
    amount: undefined,
    currency: "BRL",
    metadata: {
      notification_type: type,
      action,
      data_id: dataId,
      // Worker must fetch full payment/subscription via MercadoPago API using data_id
      requires_api_fetch: true,
    },
  };
}
