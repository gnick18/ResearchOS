// LLC business tracker, deadline-reminder email delivery via Resend.
//
// Mirrors the directory OTP mailer, a lazy Resend client from RESEND_API_KEY,
// sending from the LLC's verified research-os.app domain (override with
// EMAIL_FROM_ADDRESS), and best-effort send accounting so the operator email
// metrics include reminders. Sending to the admins only, never to any user.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { Resend } from "resend";

import { recordEmailSent } from "@/lib/sharing/directory/db";

let resendSingleton: Resend | null = null;

const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? "ResearchOS <support@research-os.app>";

function getResend(): Resend {
  if (resendSingleton) return resendSingleton;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. The business tracker cannot send reminder emails without it.",
    );
  }
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

/**
 * Sends one deadline reminder to an operator address. Branded HTML when `html`
 * is supplied, with the plaintext `text` always set as the fallback.
 */
export async function sendReminderEmail(
  toEmail: string,
  subject: string,
  text: string,
  html?: string,
): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject,
    text,
    ...(html ? { html } : {}),
  });
  if (error) {
    throw new Error(`Resend failed to send the reminder email: ${error.message}`);
  }
  try {
    await recordEmailSent("business-reminder");
  } catch {
    // A logging failure must never turn a delivered email into a failure.
  }
}
