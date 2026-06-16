import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

type SignatureResult = { valid: boolean; reason?: string };

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function validateHotmartSignature(request: FastifyRequest): SignatureResult {
  const secret = process.env.HOTMART_WEBHOOK_TOKEN;
  if (!secret) return { valid: false, reason: "HOTMART_WEBHOOK_TOKEN not configured" };

  const token = request.headers["x-hotmart-webhook-token"] as string;
  if (!token) return { valid: false, reason: "Missing X-Hotmart-Webhook-Token header" };

  return { valid: safeCompare(token, secret) };
}

export function validateStripeSignature(request: FastifyRequest & { rawBody?: string }): SignatureResult {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { valid: false, reason: "STRIPE_WEBHOOK_SECRET not configured" };

  const sigHeader = request.headers["stripe-signature"] as string;
  if (!sigHeader) return { valid: false, reason: "Missing Stripe-Signature header" };

  const rawBody = request.rawBody ?? "";
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const v1 = parts["v1"];

  if (!timestamp || !v1) return { valid: false, reason: "Invalid Stripe-Signature format" };

  // Reject events older than 5 minutes
  if (Date.now() / 1000 - parseInt(timestamp, 10) > 300) {
    return { valid: false, reason: "Webhook timestamp too old (>5min)" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return { valid: safeCompare(v1, expected) };
}

export function validateMercadoPagoSignature(
  request: FastifyRequest & { rawBody?: string }
): SignatureResult {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return { valid: false, reason: "MERCADOPAGO_WEBHOOK_SECRET not configured" };

  const xSignature = request.headers["x-signature"] as string;
  const xRequestId = (request.headers["x-request-id"] as string) ?? "";
  if (!xSignature) return { valid: false, reason: "Missing x-signature header" };

  const parts = Object.fromEntries(xSignature.split(",").map((p) => p.split("=")));
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return { valid: false, reason: "Invalid x-signature format" };

  const dataId = (request.query as Record<string, string>)["data.id"] ?? "";
  const toSign = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(toSign).digest("hex");

  return { valid: safeCompare(v1, expected) };
}

export function validateKiwifySignature(
  request: FastifyRequest & { rawBody?: string }
): SignatureResult {
  const secret = process.env.KIWIFY_WEBHOOK_SECRET;
  if (!secret) return { valid: false, reason: "KIWIFY_WEBHOOK_SECRET not configured" };

  const signature = request.headers["x-kiwify-event-token"] as string;
  if (!signature) return { valid: false, reason: "Missing X-Kiwify-Event-Token header" };

  const rawBody = request.rawBody ?? "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  return { valid: safeCompare(signature, expected) };
}

export function validateEduzzSignature(
  request: FastifyRequest & { rawBody?: string }
): SignatureResult {
  const secret = process.env.EDUZZ_WEBHOOK_SECRET;
  if (!secret) return { valid: false, reason: "EDUZZ_WEBHOOK_SECRET not configured" };

  const token = request.headers["eduzz-token"] as string;
  if (!token) return { valid: false, reason: "Missing eduzz-token header" };

  const rawBody = request.rawBody ?? "";
  const expected = createHash("md5")
    .update(rawBody + secret)
    .digest("hex")
    .toLowerCase();

  return { valid: safeCompare(token.toLowerCase(), expected) };
}
