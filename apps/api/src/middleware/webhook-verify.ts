import { timingSafeEqual, createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

export async function webhookVerifyMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Read at call time so env changes are picked up without module reload
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return reply.status(503).send({ error: "Webhook verification not configured" });
  }

  const apiKey = request.headers["apikey"] as string
    || request.headers["x-api-key"] as string;

  if (!apiKey) {
    return reply.status(401).send({ error: "Invalid webhook secret" });
  }

  // Hash both to SHA-256 to normalize length — eliminates timing oracle via length difference
  const a = createHash("sha256").update(apiKey).digest();
  const b = createHash("sha256").update(WEBHOOK_SECRET).digest();

  if (!timingSafeEqual(a, b)) {
    return reply.status(401).send({ error: "Invalid webhook secret" });
  }
}
