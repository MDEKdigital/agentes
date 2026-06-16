import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { tryInsertBillingEvent } from "@aula-agente/database";
import { enqueueBillingOnboarding } from "../../../lib/queue";
import { validateStripeSignature } from "../../../lib/billing-webhook-signature";

export default async function stripeWebhookRoute(app: FastifyInstance) {
  app.post("/webhooks/stripe", async (request, reply) => {
    const { valid, reason } = validateStripeSignature(request as Parameters<typeof validateStripeSignature>[0]);
    if (!valid) {
      request.log.warn({ reason }, "Stripe webhook rejected");
      return reply.status(401).send({ error: "Invalid webhook signature" });
    }

    const payload = request.body as Record<string, unknown>;
    const gatewayEventId = payload.id as string | undefined;
    if (!gatewayEventId) {
      return reply.status(400).send({ error: "Missing event ID" });
    }

    const billingEvent = await tryInsertBillingEvent(getAdminClient(), {
      idempotency_key: `stripe:${gatewayEventId}`,
      gateway: "stripe",
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
