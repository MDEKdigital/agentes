import type { FastifyInstance } from "fastify";
import remarketingFlowRoutes from "./flows";
import remarketingStepRoutes from "./steps";

export default async function remarketingRoutes(app: FastifyInstance) {
  app.register(remarketingFlowRoutes);
  app.register(remarketingStepRoutes);
}
