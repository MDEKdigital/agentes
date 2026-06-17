const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@aula-agente.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface WelcomeEmailOptions {
  to: string;
  name: string;
  invitationId: string;
  orgName?: string;
  planName?: string;
}

export async function sendWelcomeEmailApi(opts: WelcomeEmailOptions): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn(`[api/email] RESEND_API_KEY not configured — skipping email to ${opts.to}`);
    return;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(opts.invitationId)) {
    throw new Error(`Invalid invitationId format: ${opts.invitationId}`);
  }

  const acceptUrl = `${PUBLIC_APP_URL}/accept-invitation?id=${opts.invitationId}`;
  const safeName = escapeHtml(opts.name.split(" ")[0] || opts.name);

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111;">
  <h2 style="margin-bottom: 8px;">Olá, ${safeName}!</h2>
  <p>Seu link de acesso foi renovado. Clique no botão abaixo para acessar sua conta:</p>
  <a href="${acceptUrl}"
     style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">
    Acessar minha conta
  </a>
  <p style="color:#666;font-size:13px;">
    O link expira em 7 dias.
  </p>
</body>
</html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: opts.to,
      subject: "Seu novo link de acesso",
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend API error ${response.status}: ${text}`);
  }
}
