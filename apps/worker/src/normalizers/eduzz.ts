import type { BillingEventType, NormalizedBillingEvent } from "@aula-agente/shared";

// Eduzz status codes: 1=open, 2=processing, 3=waiting, 4=disputed, 5=paid, 6=refund_requested,
// 7=refunded, 8=chargeback, 9=cancelled, 10=expired
function classifyEventType(status: string | number | undefined): BillingEventType {
  const s = Number(status);
  if (s === 5) return "subscription.activated";
  if (s === 7 || s === 6) return "refund.processed";
  if (s === 8) return "refund.processed";
  if (s === 9 || s === 10) return "subscription.cancelled";
  return "unknown";
}

export function normalizeEduzz(raw: Record<string, unknown>): NormalizedBillingEvent {
  const status = raw.trans_status ?? raw.status;
  const eventType = classifyEventType(status as string | number | undefined);

  const amountRaw = raw.trans_value ?? raw.amount;
  const amount =
    typeof amountRaw === "number" ? Math.round(amountRaw * 100) :
    typeof amountRaw === "string" ? Math.round(parseFloat(amountRaw) * 100) :
    undefined;

  return {
    event_type: eventType,
    gateway: "eduzz",
    gateway_event_id: String(raw.trans_cod ?? raw.id ?? ""),
    customer: {
      email: String(raw.cus_email ?? ""),
      name: String(raw.cus_name ?? raw.cus_taxnumber_name ?? ""),
      document: raw.cus_taxnumber ? String(raw.cus_taxnumber) : undefined,
      phone: raw.cus_cel ?? raw.cus_phone ? String(raw.cus_cel ?? raw.cus_phone) : undefined,
    },
    product: {
      gateway_product_id: String(raw.product_id ?? raw.pro_id ?? ""),
      name: String(raw.product_name ?? raw.pro_name ?? ""),
    },
    amount,
    currency: "BRL",
    metadata: {
      trans_status: status,
      trans_cod: raw.trans_cod,
      payment_method: raw.pay_type_id,
    },
  };
}
