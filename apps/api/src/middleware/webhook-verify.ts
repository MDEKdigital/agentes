import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function webhookVerifyMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if (!WEBHOOK_SECRET) {
    return reply.status(503).send({ error: "Webhook verification not configured" });
  }

  const apiKey = request.headers["apikey"] as string
    || request.headers["x-api-key"] as string;

  if (!apiKey) {
    return reply.status(401).send({ error: "Invalid webhook secret" });
  }

  // Timing-safe comparison to prevent timing oracle attacks
  let valid = false;
  try {
    const a = Buffer.from(apiKey);
    const b = Buffer.from(WEBHOOK_SECRET);
    valid = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    valid = false;
  }

  if (!valid) {
    return reply.status(401).send({ error: "Invalid webhook secret" });
  }
}
