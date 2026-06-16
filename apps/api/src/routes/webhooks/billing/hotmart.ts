import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { tryInsertBillingEvent } from "@aula-agente/database";
import { enqueueBillingOnboarding } from "../../../lib/queue";
import { validateHotmartSignature } from "../../../lib/billing-webhook-signature";

function extractEventId(payload: Record<string, unknown>): string | null {
  // Hotmart v2: top-level "id" field
  if (typeof payload.id === "string" && payload.id) return payload.id;
  // Fallback: purchase transaction code
  const data = payload.data as Record<string, unknown> | undefined;
  const purchase = data?.purchase as Record<string, unknown> | undefined;
  if (typeof purchase?.transaction === "string") return purchase.transaction;
  return null;
}

export default async function hotmartWebhookRoute(app: FastifyInstance) {
  app.post("/webhooks/hotmart", async (request, reply) => {
    const { valid, reason } = validateHotmartSignature(request);
    if (!valid) {
      request.log.warn({ reason }, "Hotmart webhook rejected");
      return reply.status(401).send({ error: "Invalid webhook signature" });
    }

    const payload = request.body as Record<string, unknown>;
    const gatewayEventId = extractEventId(payload);
    if (!gatewayEventId) {
      request.log.warn({ payload }, "Hotmart webhook missing event ID");
      return reply.status(400).send({ error: "Missing event ID" });
    }

    const billingEvent = await tryInsertBillingEvent(getAdminClient(), {
      idempotency_key: `hotmart:${gatewayEventId}`,
      gateway: "hotmart",
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
