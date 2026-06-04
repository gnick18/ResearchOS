// Cross-boundary sharing, directory OTP email delivery (Phase 1b-ii).
//
// Sends the 6-digit signup code over email via Resend. Until a real domain is
// verified in Resend we send from the Resend test sender onboarding@resend.dev,
// which is fine for the beta. The client is built lazily from RESEND_API_KEY so
// importing this during build or tsc requires no secret.

import { Resend } from "resend";

let resendSingleton: Resend | null = null;

const FROM_ADDRESS = "ResearchOS <onboarding@resend.dev>";

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

/**
 * Sends the signup OTP to the user's email. Plain subject and body with the
 * 6-digit code, no HTML or branding for the beta. Throws if Resend reports an
 * error so the route can return a generic failure rather than claim success on a
 * dropped send.
 */
export async function sendOtpEmail(toEmail: string, code: string): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: "Your ResearchOS verification code",
    text: `Your ResearchOS verification code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`,
  });
  if (error) {
    throw new Error(`Resend failed to send the OTP email: ${error.message}`);
  }
}
