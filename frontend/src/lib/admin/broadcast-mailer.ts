// Admin broadcast email helpers.
//
// Builds branded HTML for a broadcast message using the shared renderEmailLayout,
// and sends via Resend from support@research-os.app. The compose form supplies
// subject, body paragraphs (plain text, converted to <p> tags), and an optional
// CTA button (label + url). The layout auto-adds the brand header, rainbow band,
// mascot, footer, and postal address.

import { Resend } from "resend";

import {
  escapeHtml,
  renderEmailLayout,
  renderEmailTextFooter,
  EMAIL_COLORS,
  POSTAL_ADDRESS,
} from "@/lib/email/layout";
import { recordEmailSent } from "@/lib/sharing/directory/db";

let resendSingleton: Resend | null = null;

const BROADCAST_FROM =
  process.env.EMAIL_FROM_ADDRESS ?? "ResearchOS <support@research-os.app>";

function getResend(): Resend {
  if (resendSingleton) return resendSingleton;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set.");
  }
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

export interface BroadcastPayload {
  subject: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/** Convert plain-text body (one paragraph per blank-line-separated block) to HTML. */
function bodyToHtml(body: string): string {
  const { muted } = EMAIL_COLORS;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs
    .map(
      (p) =>
        `<p style="font-size:14px;line-height:1.7;color:${muted};margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
}

/** Build the full branded HTML for a broadcast. Pure, no I/O. */
export function buildBroadcastHtml(msg: BroadcastPayload): string {
  return renderEmailLayout({
    preheader: msg.subject,
    heading: escapeHtml(msg.subject),
    bodyHtml: bodyToHtml(msg.body),
    cta:
      msg.ctaLabel && msg.ctaUrl
        ? { label: msg.ctaLabel, url: msg.ctaUrl }
        : undefined,
    footerNoteHtml: `<p style="margin:0;color:${EMAIL_COLORS.faint};">ResearchOS is a free, open electronic lab notebook. <a href="https://research-os.app" style="color:${EMAIL_COLORS.action};text-decoration:underline;">research-os.app</a></p>`,
    showPostal: true,
  });
}

/** Plaintext fallback for the broadcast. */
export function buildBroadcastText(msg: BroadcastPayload): string {
  const lines: string[] = [];
  lines.push(msg.subject, "");
  lines.push(msg.body);
  if (msg.ctaLabel && msg.ctaUrl) {
    lines.push("", `${msg.ctaLabel}: ${msg.ctaUrl}`);
  }
  lines.push(
    ...renderEmailTextFooter({
      note: "ResearchOS is a free, open electronic lab notebook. research-os.app",
      showPostal: true,
    }),
  );
  return lines.join("\n");
}

/** Send one broadcast email to a single recipient. Throws on Resend error. */
export async function sendBroadcastEmail(
  toEmail: string,
  msg: BroadcastPayload,
): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: BROADCAST_FROM,
    to: toEmail,
    subject: msg.subject,
    html: buildBroadcastHtml(msg),
    text: buildBroadcastText(msg),
  });
  if (error) {
    throw new Error(`Resend broadcast error: ${error.message}`);
  }
  try {
    await recordEmailSent("broadcast");
  } catch {
    // best-effort
  }
}
