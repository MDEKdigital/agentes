import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { tryInsertBillingEvent } from "@aula-agente/database";
import { enqueueBillingOnboarding } from "../../../lib/queue";
import { validateKiwifySignature } from "../../../lib/billing-webhook-signature";

export default async function kiwifyWebhookRoute(app: FastifyInstance) {
  app.post("/webhooks/kiwify", async (request, reply) => {
    const { valid, reason } = validateKiwifySignature(
      request as Parameters<typeof validateKiwifySignature>[0]
    );
    if (!valid) {
      request.log.warn({ reason }, "Kiwify webhook rejected");
      return reply.status(401).send({ error: "Invalid webhook signature" });
    }

    const payload = request.body as Record<string, unknown>;
    const gatewayEventId = (payload.order_id as string | undefined) ?? (payload.id as string | undefined);
    if (!gatewayEventId) {
      return reply.status(400).send({ error: "Missing event ID" });
    }

    const billingEvent = await tryInsertBillingEvent(getAdminClient(), {
      idempotency_key: `kiwify:${gatewayEventId}`,
      gateway: "kiwify",
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
