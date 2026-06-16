import type { FastifyInstance } from "fastify";
import { getAdminClient } from "@aula-agente/database";
import { tryInsertBillingEvent } from "@aula-agente/database";
import { enqueueBillingOnboarding } from "../../../lib/queue";
import { validateEduzzSignature } from "../../../lib/billing-webhook-signature";

export default async function eduzzWebhookRoute(app: FastifyInstance) {
  app.post("/webhooks/eduzz", async (request, reply) => {
    const { valid, reason } = validateEduzzSignature(
      request as Parameters<typeof validateEduzzSignature>[0]
    );
    if (!valid) {
      request.log.warn({ reason }, "Eduzz webhook rejected");
      return reply.status(401).send({ error: "Invalid webhook signature" });
    }

    const payload = request.body as Record<string, unknown>;
    // Eduzz: trans_cod is the transaction code
    const gatewayEventId = (payload.trans_cod as string | undefined) ?? (payload.id as string | undefined);
    if (!gatewayEventId) {
      return reply.status(400).send({ error: "Missing event ID" });
    }

    const billingEvent = await tryInsertBillingEvent(getAdminClient(), {
      idempotency_key: `eduzz:${gatewayEventId}`,
      gateway: "eduzz",
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
