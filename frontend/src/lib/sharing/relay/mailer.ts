// Cross-boundary sharing, the branded INVITE email (invite-a-non-user loop).
//
// When a sender invites a person who is not yet on ResearchOS, WE send a
// transactional email from our own domain (not the user's mail client). The
// email is the trust channel for a keyless invite, so it is deliberately a
// branded, professional, CAN-SPAM-compliant message, BeakerBot, a one-line
// explanation, the accept button, what ResearchOS is in a sentence, and a
// footer with a physical address and an abuse / do-not-invite line.
//
// CONTENT MINIMIZATION. The body carries ONLY the item TITLE the sender chose
// to expose, never any research content (the data is parked sealed on the relay,
// not attached here). The accept link is KEYLESS, a bare /accept/<id> landing
// with NO fragment and NO key (P1-A, docs/proposals/INVITE_KEY_OUT_OF_EMAIL.md).
// The one-time decryption key never reaches this email or Resend's retained log,
// the SENDER delivers it to the recipient out of band as a private link or unlock
// code. So this email opens a landing that asks for that code, it is not itself
// sufficient to decrypt the item.
//
// LIVE SENDING PREREQUISITE. Sending from a research-os.app address requires the
// domain verified in Resend (SPF / DKIM / DMARC), a separate human DNS step. The
// FROM address is read from RESEND_INVITE_FROM with a research-os.app default, so
// this code is ready, but it will not actually deliver until that DNS step is
// done. The Resend client is built lazily from RESEND_API_KEY so importing this
// during a build or a tsc pass requires no secret.

import { Resend } from "resend";

import { recordEmailSent } from "../directory/db";
import {
  emailAssetOrigin,
  escapeHtml,
  POSTAL_ADDRESS,
  renderEmailLayout,
} from "@/lib/email/layout";

let resendSingleton: Resend | null = null;

/**
 * The branded from-address for invite emails. Defaults to a research-os.app
 * address (the doc's decision) and is overridable via env so the verified
 * sender can be tuned without a code change. NOTE live delivery requires this
 * domain verified in Resend first.
 */
const INVITE_FROM_ADDRESS =
  process.env.RESEND_INVITE_FROM ?? "ResearchOS <support@research-os.app>";

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
      "RESEND_API_KEY is not set. ResearchOS cannot send invite emails without it.",
    );
  }
  resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

/**
 * The item kinds an invite can carry. Only the email's noun depends on it,
 * everything else (the sealed payload, the accept link) is identical. Defaults to
 * "note" wherever omitted, so the original note invite copy is unchanged.
 */
export type InviteItemKind =
  | "note"
  | "experiment"
  | "method"
  | "project"
  | "sequence"
  | "calculator";

/** The bare noun and its article for each kind, used to phrase the email copy. */
function itemNoun(kind: InviteItemKind | undefined): { article: string; noun: string } {
  switch (kind) {
    case "experiment":
      return { article: "an", noun: "experiment" };
    case "method":
      return { article: "a", noun: "method" };
    case "project":
      return { article: "a", noun: "project" };
    case "sequence":
      return { article: "a", noun: "sequence" };
    case "calculator":
      return { article: "a", noun: "calculator" };
    case "note":
    default:
      // The original copy says "research note", keep it for the note path.
      return { article: "a", noun: "research note" };
  }
}

/** Everything the invite email template needs. */
export interface InviteEmailParams {
  /** The recipient's plaintext email (we send to it, but never store it). */
  toEmail: string;
  /**
   * The sender's display label for the body ("{name} shared a note with you").
   * This is the sender's own claimed email or a name they expose, NOT a hash.
   */
  senderLabel: string;
  /** The note/method TITLE the sender chose to expose. The ONLY content teaser. */
  itemTitle: string;
  /**
   * The KEYLESS accept landing link (https://research-os.app/accept/<id>), with
   * NO fragment and NO key. Built server-side by the confirm route from the
   * verified inviteId (P1-A), never carries the one-time key. It opens the
   * landing where the recipient pastes the unlock code the sender sent them out
   * of band, so this link alone cannot decrypt the item.
   */
  acceptUrl: string;
  /**
   * Which kind of item this invite carries, so the body reads "a research note" /
   * "an experiment" / "a method" / "a project". Omit for the note path.
   */
  itemKind?: InviteItemKind;
}

// HTML-escape (escapeHtml), the absolute asset origin (emailAssetOrigin), the
// mascot URL (beakerbotImageUrl), and the postal address now come from the shared
// email layout module (@/lib/email/layout), so every email uses one brand wrapper
// rather than each re-deriving these. `esc` below is kept as a thin local alias
// so the existing call sites read unchanged.
const esc = escapeHtml;

/**
 * Builds the transactional invite email subject. Named the sender, one specific
 * item, no marketing language, exactly the framing that lands in inboxes rather
 * than spam.
 */
export function inviteSubject(
  senderLabel: string,
  itemKind?: InviteItemKind,
): string {
  const { article, noun } = itemNoun(itemKind);
  return `${senderLabel} shared ${article} ${noun} with you on ResearchOS`;
}

/**
 * Builds the HTML body of the invite email. Pure (no I/O), so it can be unit
 * tested. The body interpolates only the sender label, the item title, and the
 * accept URL, all escaped. NO research content beyond the title.
 */
export function buildInviteHtml(params: InviteEmailParams): string {
  const sender = esc(params.senderLabel);
  const title = esc(params.itemTitle);
  const { article, noun } = itemNoun(params.itemKind);
  // The accept URL is placed in href verbatim. It is a same-team-built KEYLESS
  // URL (research-os.app/accept/<uuid>, no fragment), so it carries no secret and
  // is URL-safe to embed directly.
  const url = params.acceptUrl;
  return renderEmailLayout({
    preheader: `${sender} shared ${article} ${noun} with you on ResearchOS.`,
    heading: `${sender} shared ${article} ${noun} with you`,
    bodyHtml: `<p style="font-size:14px;line-height:1.6;color:#4b5563;text-align:center;margin:0 0 20px;">
        They used ResearchOS to send you an encrypted copy of
        <strong style="color:#111827;">&ldquo;${title}&rdquo;</strong>.
        Create your free account here, then ${sender} will send you a separate
        private link or unlock code to open it. The ${noun} stays sealed until
        you have that.
      </p>`,
    cta: { label: "Create your free account", url },
    secondaryHtml: `<p style="font-size:13px;line-height:1.6;color:#6b7280;text-align:center;margin:0;">
        ResearchOS is a free, open electronic lab notebook. Notes, methods, and
        data stay in your own folder, and sharing across labs is end-to-end
        encrypted.
      </p>`,
    footerNoteHtml: `<p style="margin:0 0 4px;">
        You received this because ${sender} chose to share a specific item with
        this address. The shared content is not in this email, it is parked
        encrypted until you open it.
      </p>`,
    showPostal: true,
    footerLinks: [
      { label: "Do not invite me again", url: `${url}&unsubscribe=1` },
      { label: "Report abuse", url: `${url}&report=1` },
    ],
  });
}

/**
 * The plaintext fallback body, for clients that do not render HTML. Same content
 * minimization, the title plus the accept link, nothing else.
 */
export function buildInviteText(params: InviteEmailParams): string {
  const { article, noun } = itemNoun(params.itemKind);
  return [
    `${params.senderLabel} shared ${article} ${noun} with you on ResearchOS.`,
    ``,
    `They sent you an encrypted copy of "${params.itemTitle}". Create your free`,
    `account, then ${params.senderLabel} will send you a separate private link or`,
    `unlock code to open it. The ${noun} stays sealed until you have that.`,
    ``,
    `Create your free account here: ${params.acceptUrl}`,
    ``,
    `ResearchOS is a free, open electronic lab notebook. The shared content is`,
    `not in this email, it is parked encrypted until you open it.`,
    ``,
    POSTAL_ADDRESS,
    `Do not invite me again: ${params.acceptUrl}&unsubscribe=1`,
  ].join("\n");
}

/**
 * Sends the branded invite email via Resend. Throws if Resend reports an error
 * so the calling route can return a generic failure rather than claim success on
 * a dropped send. The acceptUrl is the keyless landing link (no key, P1-A), used
 * only to compose the body, and is never logged here.
 */
export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: INVITE_FROM_ADDRESS,
    to: params.toEmail,
    subject: inviteSubject(params.senderLabel, params.itemKind),
    html: buildInviteHtml(params),
    text: buildInviteText(params),
  });
  if (error) {
    throw new Error(`Resend failed to send the invite email: ${error.message}`);
  }
  // Best-effort send accounting for the operator dashboard (same table as the
  // OTP sends). A logging failure must never turn a delivered email into a
  // reported failure, so swallow it.
  try {
    await recordEmailSent("share_invite");
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// External-collab invite NUDGE email.
//
// Distinct from the keyless invite above. Here the recipient is ALREADY a
// registered ResearchOS user with an in-app inbox invite, so this email is just
// a nudge to go look. It carries NO secret key and NO accept link with embedded
// material, only the sender label, the item title, and a plain link to the app.
// The recipient accepts inside ResearchOS under "Shared with me", never from a
// URL in this email. Content is minimized to the same precedent as the send-
// outside invite (title + sender only).
// ---------------------------------------------------------------------------

/** Everything the collab-invite nudge email template needs. */
export interface CollabInviteEmailParams {
  /** The recipient's plaintext email. We send to it but never store it. */
  toEmail: string;
  /** The sender's display label (their name or email). NOT a hash. */
  senderLabel: string;
  /** The note TITLE the sender chose to expose. The ONLY content teaser. */
  noteTitle: string;
}

/** A plain link to the app's "Shared with me" surface. No secret, no token. */
function sharedWithMeUrl(): string {
  return `${emailAssetOrigin()}/?shared=1`;
}

/** Subject line for the collab-invite nudge. Named sender, one item, no marketing. */
export function collabInviteSubject(senderLabel: string): string {
  return `${senderLabel} invited you to collaborate on ResearchOS`;
}

/**
 * HTML body of the collab-invite nudge. Pure (no I/O), so it is unit-testable.
 * Interpolates only the escaped sender label and note title, plus a plain app
 * link. No research content beyond the title, no secret link.
 */
export function buildCollabInviteHtml(params: CollabInviteEmailParams): string {
  const sender = esc(params.senderLabel);
  const title = esc(params.noteTitle);
  const url = sharedWithMeUrl();
  return renderEmailLayout({
    preheader: `${sender} invited you to collaborate on ResearchOS.`,
    heading: `${sender} invited you to collaborate`,
    bodyHtml: `<p style="font-size:14px;line-height:1.6;color:#4b5563;text-align:center;margin:0 0 20px;">
        ${sender} invited you to collaborate on
        <strong style="color:#111827;">&ldquo;${title}&rdquo;</strong> in
        ResearchOS. Open ResearchOS and go to Shared with me to accept.
      </p>`,
    cta: { label: "Open ResearchOS", url },
    secondaryHtml: `<p style="font-size:13px;line-height:1.6;color:#6b7280;text-align:center;margin:0;">
        The invite is also waiting for you in ResearchOS under Shared with me.
        Nothing is shared until you accept it there.
      </p>`,
    footerNoteHtml: `<p style="margin:0 0 4px;">
        You received this because you opted in to collaboration-invite emails and
        ${sender} invited you to collaborate. You can turn these off in
        ResearchOS under Settings, Sharing.
      </p>`,
    showPostal: true,
  });
}

/** Plaintext fallback body. Same content minimization, no secret link. */
export function buildCollabInviteText(params: CollabInviteEmailParams): string {
  return [
    `${params.senderLabel} invited you to collaborate on "${params.noteTitle}" in ResearchOS.`,
    ``,
    `Open ResearchOS and go to Shared with me to accept.`,
    ``,
    sharedWithMeUrl(),
    ``,
    `You received this because you opted in to collaboration-invite emails. You`,
    `can turn these off in ResearchOS under Settings, Sharing.`,
    ``,
    POSTAL_ADDRESS,
  ].join("\n");
}

/**
 * Sends the collab-invite nudge email via Resend. Throws if Resend reports an
 * error so the calling route can decide how to respond. Records a coarse send
 * kind for the operator dashboard, best-effort.
 */
export async function sendCollabInviteEmail(
  params: CollabInviteEmailParams,
): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: INVITE_FROM_ADDRESS,
    to: params.toEmail,
    subject: collabInviteSubject(params.senderLabel),
    html: buildCollabInviteHtml(params),
    text: buildCollabInviteText(params),
  });
  if (error) {
    throw new Error(
      `Resend failed to send the collab-invite email: ${error.message}`,
    );
  }
  try {
    await recordEmailSent("collab_invite");
  } catch {
    // ignore
  }
}
