import type { FastifyInstance } from "fastify";
import subscriptionRoute from "./subscription";

export default async function billingRoutes(app: FastifyInstance) {
  app.register(subscriptionRoute);
}
