// Lab-invite email (the "join a lab" loop).
//
// Today a lab head copies an invite link and sends it themselves. This adds the
// OPTION for ResearchOS to deliver a branded invite email on their behalf. It is
// deliberately DECOUPLED from how the invite link is built, the caller passes in
// the already-composed /lab/join link (the lab system owns that shape), and this
// module only wraps it in the shared brand layout and sends it. So this can ship
// before the lab membership UI settles, the UI just POSTs the link when ready.
//
// The link carries the invite in its URL fragment (#inv=...), which a browser
// never transmits to a server. We put it in the email (the trust channel) and do
// not log it. The send route additionally refuses any URL that is not one of our
// own /lab/join links, so this endpoint cannot be used to mail arbitrary links.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { Resend } from "resend";

import { recordEmailSent } from "@/lib/sharing/directory/db";
import { escapeHtml, renderEmailLayout } from "@/lib/email/layout";

let resendSingleton: Resend | null = null;

/** Branded invite from-address, shared with the cross-lab invite sender. */
const INVITE_FROM_ADDRESS =
  process.env.RESEND_INVITE_FROM ?? "ResearchOS <support@research-os.app>";

function getResend(): Resend {
  if (resendSingleton) return resendSingleton;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. ResearchOS cannot send lab-invite emails without it.",
    );
  }
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

export interface LabInviteEmailParams {
  /** Recipient's plaintext email. We send to it but never store it. */
  toEmail: string;
  /** The lab head's display label (name or email) for the body. */
  senderLabel: string;
  /** The lab's display name ("the Nickles Lab"). */
  labName: string;
  /**
   * The full /lab/join invite link including its #inv= fragment. Composed by the
   * lab system and passed in transiently to compose the body. Never logged.
   */
  inviteUrl: string;
}

/** Subject line. Named sender + named lab, no marketing language. */
export function labInviteSubject(senderLabel: string, labName: string): string {
  return `${senderLabel} invited you to join ${labName} on ResearchOS`;
}

/** Branded HTML body. Pure (no I/O), unit-testable. */
export function buildLabInviteHtml(params: LabInviteEmailParams): string {
  const sender = escapeHtml(params.senderLabel);
  const lab = escapeHtml(params.labName);
  const url = params.inviteUrl;
  return renderEmailLayout({
    preheader: `${sender} invited you to join ${lab} on ResearchOS.`,
    heading: `You have been invited to join ${lab}`,
    bodyHtml: `<p style="font-size:14px;line-height:1.6;color:#4b5563;text-align:center;margin:0 0 20px;">
        ${sender} invited you to join their lab on ResearchOS, the free, open
        electronic lab notebook. Accept to set up your account and connect your
        data folder. Your notebook stays in your own folder, you just share a
        workspace.
      </p>`,
    cta: { label: "Join the lab", url },
    secondaryHtml: `<p style="font-size:13px;line-height:1.6;color:#6b7280;text-align:center;margin:0;">
        New to ResearchOS? Joining creates your free account. Notes, methods, and
        data stay local in your own folder.
      </p>`,
    footerNoteHtml: `<p style="margin:0 0 4px;">
        You received this because ${sender} invited this address to their lab on
        ResearchOS.
      </p>`,
    showPostal: true,
  });
}

/** Plaintext fallback body. */
export function buildLabInviteText(params: LabInviteEmailParams): string {
  return [
    `${params.senderLabel} invited you to join ${params.labName} on ResearchOS.`,
    ``,
    `ResearchOS is a free, open electronic lab notebook. Accept to set up your`,
    `account and connect your data folder. Your notebook stays in your own folder,`,
    `you just share a workspace.`,
    ``,
    `Join the lab here: ${params.inviteUrl}`,
    ``,
    `New to ResearchOS? Joining creates your free account.`,
  ].join("\n");
}

/**
 * Sends the branded lab-invite email via Resend. Throws if Resend reports an
 * error so the calling route can return a generic failure. Records a coarse send
 * kind for the operator dashboard, best-effort.
 */
export async function sendLabInviteEmail(params: LabInviteEmailParams): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: INVITE_FROM_ADDRESS,
    to: params.toEmail,
    subject: labInviteSubject(params.senderLabel, params.labName),
    html: buildLabInviteHtml(params),
    text: buildLabInviteText(params),
  });
  if (error) {
    throw new Error(`Resend failed to send the lab-invite email: ${error.message}`);
  }
  try {
    await recordEmailSent("lab_invite");
  } catch {
    // A logging failure must never turn a delivered email into a failure.
  }
}
