import type { BillingEventType, BillingInterval, NormalizedBillingEvent } from "@aula-agente/shared";

const EVENT_TYPE_MAP: Record<string, BillingEventType> = {
  "checkout.session.completed": "subscription.activated",
  "invoice.payment_succeeded": "subscription.renewed",
  "customer.subscription.deleted": "subscription.cancelled",
  "invoice.payment_failed": "subscription.past_due",
  "charge.refunded": "refund.processed",
};

function classifyInterval(interval: string | undefined): BillingInterval {
  if (interval === "year") return "yearly";
  if (interval === "month") return "monthly";
  return "manual";
}

export function normalizeStripe(raw: Record<string, unknown>): NormalizedBillingEvent {
  const stripeType = raw.type as string | undefined;
  const eventType: BillingEventType = EVENT_TYPE_MAP[stripeType ?? ""] ?? "unknown";
  const dataObj = (raw.data as Record<string, unknown> | undefined)?.object as
    | Record<string, unknown>
    | undefined ?? {};

  // checkout.session: customer_email + subscription + metadata
  // invoice: customer_email + subscription + lines
  const customerEmail =
    (dataObj.customer_email as string | undefined) ??
    (dataObj.receipt_email as string | undefined) ??
    "";
  const customerName = (dataObj.customer_name as string | undefined) ?? "";
  const customerId = (dataObj.customer as string | undefined) ?? "";
  const subscriptionId = (dataObj.subscription as string | undefined) ?? "";
  const metadata = (dataObj.metadata as Record<string, string> | undefined) ?? {};

  // Price / plan info from line items or subscription
  const lines = (dataObj.lines as Record<string, unknown> | undefined)?.data as
    | Record<string, unknown>[]
    | undefined;
  const firstLine = lines?.[0] ?? {};
  const linePrice = firstLine.price as Record<string, unknown> | undefined;
  const priceId = (dataObj.price as string | undefined) ?? (linePrice?.id as string | undefined) ?? "";
  const productId =
    (linePrice?.product as string | undefined) ?? (dataObj.product as string | undefined) ?? "";
  const recurringInterval = (linePrice?.recurring as Record<string, string> | undefined)?.interval;

  const amountTotal =
    typeof dataObj.amount_total === "number"
      ? dataObj.amount_total
      : typeof dataObj.amount_paid === "number"
        ? dataObj.amount_paid
        : undefined;

  return {
    event_type: eventType,
    gateway: "stripe",
    gateway_event_id: String(raw.id ?? ""),
    customer: {
      email: customerEmail,
      name: customerName,
    },
    product: {
      gateway_product_id: productId,
      gateway_plan_id: priceId,
      name: metadata.product_name ?? "",
      plan_slug: metadata.plan_slug,
    },
    subscription: subscriptionId
      ? {
          gateway_subscription_id: subscriptionId,
          gateway_customer_id: customerId || undefined,
          interval: classifyInterval(recurringInterval),
          current_period_start: dataObj.current_period_start
            ? new Date((dataObj.current_period_start as number) * 1000).toISOString()
            : undefined,
          current_period_end: dataObj.current_period_end
            ? new Date((dataObj.current_period_end as number) * 1000).toISOString()
            : undefined,
        }
      : undefined,
    amount: amountTotal,
    currency: (dataObj.currency as string | undefined)?.toUpperCase() ?? "BRL",
    metadata: { stripe_event_type: stripeType },
  };
}
