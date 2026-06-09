// Cross-boundary sharing, directory OTP email delivery (Phase 1b-ii).
//
// Sends the 6-digit signup code over email via Resend, from the LLC's verified
// research-os.app domain. Override with EMAIL_FROM_ADDRESS if the sending
// identity changes. The client is built lazily from RESEND_API_KEY so importing
// this during build or tsc requires no secret.

import { Resend } from "resend";

import { recordEmailSent } from "./db";
import { EMAIL_COLORS, escapeHtml, renderEmailLayout } from "@/lib/email/layout";

let resendSingleton: Resend | null = null;

const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? "ResearchOS <support@research-os.app>";

/**
 * Lazily constructs the Resend client from RESEND_API_KEY. Throws a clear error
 * if the key is missing so a misconfigured deployment fails at request time
 * rather than silently dropping the email.
 */
function getResend(): Resend {
  if (resendSingleton) return resendSingleton;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. The directory cannot send OTP emails without it.",
    );
  }
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

/** Plaintext OTP body (fallback for clients that do not render HTML). */
export function buildOtpText(code: string): string {
  return `Your ResearchOS verification code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`;
}

/**
 * Branded HTML OTP body. Pure (no I/O), unit-testable. The code is the only
 * interpolation, escaped defensively even though it is a generated 6-digit
 * string. This is the first email most users ever get from us, so it carries the
 * brand wrapper (mascot, sky wordmark, rainbow band) like every other email.
 */
export function buildOtpHtml(code: string): string {
  const { ink, muted, faint, action } = EMAIL_COLORS;
  const safe = escapeHtml(code);
  return renderEmailLayout({
    preheader: "Your ResearchOS verification code (expires in 15 minutes).",
    bodyHtml: `<p style="font-size:14px;line-height:1.6;color:${muted};text-align:center;margin:0 0 16px;">
        Enter this code to verify your email. It expires in 15 minutes.
      </p>
      <div style="font-size:32px;font-weight:700;letter-spacing:0.22em;color:${ink};background:#f1f7fb;border:1px solid #d6e8f4;border-radius:10px;padding:14px 0;margin:0 0 14px;text-align:center;">${safe}</div>
      <p style="font-size:12px;line-height:1.6;color:${faint};text-align:center;margin:0;">
        If you did not request this, you can ignore this email.
      </p>`,
    footerNoteHtml: `<p style="margin:0;color:${faint};">ResearchOS is a free, open electronic lab notebook. <a href="https://research-os.app" style="color:${action};text-decoration:underline;">research-os.app</a></p>`,
  });
}

/**
 * Sends the signup OTP to the user's email, branded HTML plus a plaintext
 * fallback. Throws if Resend reports an error so the route can return a generic
 * failure rather than claim success on a dropped send.
 */
export async function sendOtpEmail(toEmail: string, code: string): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: "Your ResearchOS verification code",
    html: buildOtpHtml(code),
    text: buildOtpText(code),
  });
  if (error) {
    throw new Error(`Resend failed to send the OTP email: ${error.message}`);
  }
  // Best-effort send accounting for the operator dashboard. A logging failure
  // must never turn a delivered email into a reported failure, so swallow it.
  try {
    await recordEmailSent("otp");
  } catch {
    // ignore
  }
}
