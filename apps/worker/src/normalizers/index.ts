import type { BillingGateway, NormalizedBillingEvent } from "@aula-agente/shared";
import { normalizeHotmart } from "./hotmart";
import { normalizeStripe } from "./stripe";
import { normalizeMercadoPago } from "./mercadopago";
import { normalizeKiwify } from "./kiwify";
import { normalizeEduzz } from "./eduzz";

export type { NormalizedBillingEvent };

export function normalizePayload(
  gateway: BillingGateway,
  raw: Record<string, unknown>
): NormalizedBillingEvent {
  switch (gateway) {
    case "hotmart":
      return normalizeHotmart(raw);
    case "stripe":
      return normalizeStripe(raw);
    case "mercadopago":
      return normalizeMercadoPago(raw);
    case "kiwify":
      return normalizeKiwify(raw);
    case "eduzz":
      return normalizeEduzz(raw);
  }
}
