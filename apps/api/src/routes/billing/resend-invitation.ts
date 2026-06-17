import type { FastifyInstance } from "fastify";
import {
  getAdminClient,
  findInvitationByEmailForResend,
  renewInvitationExpiry,
} from "@aula-agente/database";
import { authMiddleware } from "../../middleware/auth";
import { sendWelcomeEmailApi } from "../../lib/email";

const NEUTRAL_MSG = "Se um convite estiver disponível, o email foi reenviado.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function resendInvitationRoute(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.post("/billing/resend-invitation", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null | undefined;
    const email = typeof body?.email === "string" ? body.email.trim() : "";

    if (!email || !EMAIL_RE.test(email)) {
      return reply.status(400).send({ error: "Email inválido." });
    }

    const db = getAdminClient();

    let invitation;
    try {
      invitation = await findInvitationByEmailForResend(db, email);
    } catch (err) {
      request.log.error({ err }, "resend-invitation: db error finding invitation");
      return reply.status(500).send({ error: "Erro interno." });
    }

    if (!invitation) {
      return reply.send({ message: NEUTRAL_MSG });
    }

    // Extend expiry by 7 days from now
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      await renewInvitationExpiry(db, invitation.id, newExpiresAt);
    } catch (err) {
      request.log.error({ err }, "resend-invitation: db error renewing expiry");
      return reply.status(500).send({ error: "Erro interno." });
    }

    // Send email — non-fatal
    try {
      await sendWelcomeEmailApi({
        to: email,
        name: email,
        invitationId: invitation.id,
      });
    } catch (err) {
      request.log.error({ err }, "resend-invitation: email send failed (non-fatal)");
    }

    return reply.send({ message: NEUTRAL_MSG });
  });
}
