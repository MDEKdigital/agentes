import type { FastifyRequest, FastifyReply } from "fastify";

export async function superAdminMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail || request.user.email !== superAdminEmail) {
    return reply.status(403).send({ error: "Acesso restrito." });
  }
}
