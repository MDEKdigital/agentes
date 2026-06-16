import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import hotmartRoute from "./hotmart";
import stripeRoute from "./stripe";
import mercadoPagoRoute from "./mercadopago";
import kiwifyRoute from "./kiwify";
import eduzzRoute from "./eduzz";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export default async function billingWebhookRoutes(app: FastifyInstance) {
  // Capture raw body before JSON parsing — required for HMAC signature validation
  app.addHook("preParsing", async (request, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const rawBody = Buffer.concat(chunks).toString("utf-8");
    request.rawBody = rawBody;

    const newPayload = Readable.from(rawBody) as NodeJS.ReadableStream & {
      receivedEncodedLength?: number;
    };
    newPayload.receivedEncodedLength = rawBody.length;
    return newPayload;
  });

  app.register(hotmartRoute);
  app.register(stripeRoute);
  app.register(mercadoPagoRoute);
  app.register(kiwifyRoute);
  app.register(eduzzRoute);
}
