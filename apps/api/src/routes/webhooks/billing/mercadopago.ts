import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { tryInsertBillingEvent } from "@aula-agente/database";
import { enqueueBillingOnboarding } from "../../../lib/queue";
import { validateMercadoPagoSignature } from "../../../lib/billing-webhook-signature";

function extractEventId(payload: Record<string, unknown>): string | null {
  // MercadoPago notification: { id: number, data: { id: string } }
  const dataId = (payload.data as Record<string, unknown> | undefined)?.id;
  if (dataId) return String(dataId);
  if (payload.id !== undefined) return String(payload.id);
  return null;
}

export default async function mercadoPagoWebhookRoute(app: FastifyInstance) {
  app.post("/webhooks/mercadopago", async (request, reply) => {
    const { valid, reason } = validateMercadoPagoSignature(
      request as Parameters<typeof validateMercadoPagoSignature>[0]
    );
    if (!valid) {
      request.log.warn({ reason }, "MercadoPago webhook rejected");
      return reply.status(401).send({ error: "Invalid webhook signature" });
    }

    const payload = request.body as Record<string, unknown>;
    const gatewayEventId = extractEventId(payload);
    if (!gatewayEventId) {
      return reply.status(400).send({ error: "Missing event ID" });
    }

    const billingEvent = await tryInsertBillingEvent(getAdminClient(), {
      idempotency_key: `mercadopago:${gatewayEventId}`,
      gateway: "mercadopago",
      gateway_event_id: gatewayEventId,
      event_type: "unknown",
      raw_payload: payload,
    });

    if (!billingEvent) {
      return reply.status(200).send({ ok: true, skipped: "duplicate" });
    }

    await enqueueBillingOnboarding({ billingEventId: billingEvent.id });

    return reply.status(200).send({ ok: true });
  });
}
