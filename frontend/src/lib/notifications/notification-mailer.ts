// Notification email (the "lean into my inbox" channel).
//
// Sends a single notification to a user's own inbox via Resend, wrapped in the
// shared brand layout. Email is an account/cloud channel (a solo user never has
// it), and in phase 2 it is fired by the recipient's own client when a new
// notification lands in an email-enabled category, so the address is the user's
// own and is never an arbitrary third party.
//
// Decoupled from how notifications are created: the caller passes the finished
// title + body. This mirrors invite-mailer.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { Resend } from "resend";

import { recordEmailSent } from "@/lib/sharing/directory/db";
import {
  escapeHtml,
  renderEmailLayout,
  emailAssetOrigin,
} from "@/lib/email/layout";

let resendSingleton: Resend | null = null;

const NOTIFICATION_FROM_ADDRESS =
  process.env.RESEND_NOTIFICATION_FROM ??
  process.env.RESEND_INVITE_FROM ??
  "ResearchOS <support@research-os.app>";

function getResend(): Resend {
  if (resendSingleton) return resendSingleton;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. ResearchOS cannot send notification emails without it.",
    );
  }
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

export interface NotificationEmailParams {
  /** The recipient's own plaintext email. Sent to, never stored. */
  toEmail: string;
  /** Short category label, e.g. "Lab announcement". */
  title: string;
  /** The notification's one-line body. */
  body: string;
}

export function notificationSubject(title: string): string {
  return `${title} on ResearchOS`;
}

/** Branded HTML body. Pure (no I/O), unit-testable. */
export function buildNotificationHtml(params: NotificationEmailParams): string {
  const title = escapeHtml(params.title);
  const body = escapeHtml(params.body);
  const url = emailAssetOrigin();
  return renderEmailLayout({
    preheader: `${params.title}: ${params.body}`.slice(0, 120),
    heading: title,
    bodyHtml: `<p style="font-size:14px;line-height:1.6;color:#4b5563;text-align:center;margin:0 0 20px;">
        ${body}
      </p>`,
    cta: { label: "Open ResearchOS", url },
    secondaryHtml: "",
    footerNoteHtml: `<p style="margin:0 0 4px;">
        You received this because you chose to be emailed about this kind of
        notification. Change it any time in Settings, Notifications.
      </p>`,
    showPostal: true,
  });
}

/** Plaintext fallback. */
export function buildNotificationText(params: NotificationEmailParams): string {
  return [
    params.title,
    "",
    params.body,
    "",
    `Open ResearchOS: ${emailAssetOrigin()}`,
    "",
    "You chose to be emailed about this kind of notification. Change it in",
    "Settings, Notifications.",
  ].join("\n");
}

/**
 * Sends the branded notification email via Resend. Throws on a Resend error so
 * the route can return a generic failure. Best-effort operator-dashboard record.
 */
export async function sendNotificationEmail(
  params: NotificationEmailParams,
): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: NOTIFICATION_FROM_ADDRESS,
    to: params.toEmail,
    subject: notificationSubject(params.title),
    html: buildNotificationHtml(params),
    text: buildNotificationText(params),
  });
  if (error) {
    throw new Error(
      `Resend failed to send the notification email: ${error.message}`,
    );
  }
  try {
    await recordEmailSent("notification");
  } catch {
    // A logging failure must never turn a delivered email into a failure.
  }
}
