import type { FastifyInstance } from "fastify";
import subscriptionRoute from "./subscription";
import plansRoute from "./plans";
import resendInvitationRoute from "./resend-invitation";

export default async function billingRoutes(app: FastifyInstance) {
  app.register(subscriptionRoute);
  app.register(plansRoute);
  app.register(resendInvitationRoute);
}
