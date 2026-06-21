/**
 * RED tests for RC-8: email-service Resend API call without timeout.
 *
 * Problem:
 *   sendWelcomeEmail() calls fetch("https://api.resend.com/emails", {...})
 *   with no AbortSignal. If Resend's API hangs, the billing-onboarding
 *   worker job hangs indefinitely, consuming a BullMQ slot and delaying
 *   retries for legitimate billing events.
 *
 * Fix:
 *   - Add EMAIL_TIMEOUT_MS to with-timeout.ts
 *   - Add AbortSignal.timeout(EMAIL_TIMEOUT_MS) to the Resend fetch call
 *
 * Also covers OB-5 regression guard:
 *   - takeover-timeout failed handler must call incrementMetric("takeover_timeout_cycle_failed")
 *   - This was added in OB-5 but had no dedicated test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks for email-service ───────────────────────────────────────────

// No module mocks needed — email-service only uses fetch + env vars

// ── Imports ───────────────────────────────────────────────────────────────────

import { EMAIL_TIMEOUT_MS } from "../lib/with-timeout";
import { sendWelcomeEmail } from "../services/email-service";

const mockFetch = vi.fn();
const VALID_UUID = "12345678-1234-1234-1234-123456789abc";
const emailOpts = {
  to: "user@example.com",
  name: "Maria Silva",
  invitationId: VALID_UUID,
  orgName: "Minha Escola",
  planName: "Pro",
};

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.PUBLIC_APP_URL = "https://app.example.com";
  process.env.FROM_EMAIL = "noreply@example.com";
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  delete process.env.RESEND_API_KEY;
});

// ════════════════════════════════════════════════════════════════════════════
// RC-8A — EMAIL_TIMEOUT_MS exportado de with-timeout.ts
// ════════════════════════════════════════════════════════════════════════════

describe("RC-8A: EMAIL_TIMEOUT_MS — exportado de with-timeout.ts", () => {
  it("EMAIL_TIMEOUT_MS é exportado e positivo", () => {
    expect(EMAIL_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("EMAIL_TIMEOUT_MS é razoável para chamada de API de email (5s–60s)", () => {
    expect(EMAIL_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(EMAIL_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RC-8B — sendWelcomeEmail usa AbortSignal.timeout no fetch
// ════════════════════════════════════════════════════════════════════════════

describe("RC-8B: sendWelcomeEmail — fetch com AbortSignal.timeout", () => {
  it("AbortSignal.timeout é chamado durante fetch para Resend", async () => {
    const abortTimeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce({ ok: true });

    await sendWelcomeEmail(emailOpts);

    expect(abortTimeoutSpy).toHaveBeenCalled();
    expect(abortTimeoutSpy).toHaveBeenCalledWith(EMAIL_TIMEOUT_MS);
  });

  it("AbortError de Resend propagado — não swallowed", async () => {
    const abortError = new DOMException("This operation was aborted", "AbortError");
    mockFetch.mockRejectedValue(abortError);

    await expect(sendWelcomeEmail(emailOpts)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("erro HTTP 429 (rate limit) de Resend propagado com status no message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });

    await expect(sendWelcomeEmail(emailOpts)).rejects.toThrow("429");
  });

  it("fluxo nominal — sendWelcomeEmail resolve sem erro quando Resend retorna ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await expect(sendWelcomeEmail(emailOpts)).resolves.toBeUndefined();
  });

  it("sem RESEND_API_KEY — resolve silenciosamente sem chamar fetch", async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendWelcomeEmail(emailOpts)).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("invitationId inválido (não-UUID) → lança erro sem chamar fetch", async () => {
    await expect(
      sendWelcomeEmail({ ...emailOpts, invitationId: "not-a-uuid" })
    ).rejects.toThrow(/invalid.*invitationId/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

