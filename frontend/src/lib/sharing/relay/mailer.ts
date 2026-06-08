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

let resendSingleton: Resend | null = null;

/**
 * The branded from-address for invite emails. Defaults to a research-os.app
 * address (the doc's decision) and is overridable via env so the verified
 * sender can be tuned without a code change. NOTE live delivery requires this
 * domain verified in Resend first.
 */
const INVITE_FROM_ADDRESS =
  process.env.RESEND_INVITE_FROM ?? "ResearchOS <share@research-os.app>";

/**
 * Physical mailing address for the CAN-SPAM footer, overridable via env so it can
 * be set per deployment without a code change. The placeholder is clearly marked
 * so a real address is supplied before any production send.
 */
const POSTAL_ADDRESS =
  process.env.RESEND_POSTAL_ADDRESS ??
  "ResearchOS, University of Wisconsin-Madison, Madison, WI 53706, USA";

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
  | "sequence";

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

/** Minimal HTML-escape for the few interpolated text fields. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Absolute origin that serves the app's /public assets. The header mascot is
 * loaded as an <img> from here, so the URL MUST be absolute, an email client
 * cannot resolve a relative or a localhost URL. Read from the SAME env the
 * accept-URL builder uses (NEXT_PUBLIC_APP_ORIGIN) with the canonical production
 * default, so the mascot and the accept link always point at the same origin.
 * Runs server-side (the send path), so there is no window fallback here.
 */
function assetOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured && configured.length > 0) return configured.replace(/\/$/, "");
  return "https://research-os.app";
}

/**
 * Absolute URL of the real BeakerBot mascot PNG (the pastel-rainbow liquid
 * mascot, idle pose), committed under public/email/beakerbot.png. It is a RASTER
 * PNG, not inline SVG, because Gmail and Outlook strip inline SVG, so the old
 * hand-rolled SVG header never actually rendered in a real inbox. The source is
 * 192x192 (retina) and the email displays it at 48x48.
 *
 * IMPORTANT. This image only renders in real inboxes once the origin above
 * actually serves /public, i.e. once research-os.app points at the Vercel
 * deployment (DNS still pending as of this writing). Until then the email shows
 * the alt text instead, which is why the alt is a clean brand string
 * ("ResearchOS") and the wordmark sits beside the image as real styled text.
 */
function beakerbotImageUrl(): string {
  return `${assetOrigin()}/email/beakerbot.png`;
}

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
  // The accept URL is placed in href / text verbatim. It is a same-team-built
  // KEYLESS URL (research-os.app/accept/<uuid>, no fragment), so it carries no
  // secret and is URL-safe to embed directly.
  const url = params.acceptUrl;
  // Absolute mascot URL, built once for this render. A table-based lockup (mascot
  // left, "ResearchOS" wordmark beside it) is the reliable cross-client way to
  // align an image with text, matching the accept-page Header. The alt text is
  // "ResearchOS" so the lockup still reads as the brand if the image is stripped
  // or the origin is not yet serving /public.
  const mascotUrl = beakerbotImageUrl();
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px;">
        <tr>
          <td style="vertical-align:middle;padding-right:10px;">
            <img src="${mascotUrl}" width="48" height="48" alt="ResearchOS" style="display:block;width:48px;height:48px;border:0;outline:none;text-decoration:none;" />
          </td>
          <td style="vertical-align:middle;">
            <span style="font-size:22px;font-weight:700;color:#2563eb;letter-spacing:-0.01em;">ResearchOS</span>
          </td>
        </tr>
      </table>
      <h1 style="font-size:18px;font-weight:600;text-align:center;margin:8px 0 4px;">
        ${sender} shared ${article} ${noun} with you
      </h1>
      <p style="font-size:14px;line-height:1.6;color:#4b5563;text-align:center;margin:0 0 20px;">
        They used ResearchOS to send you an encrypted copy of
        <strong style="color:#111827;">&ldquo;${title}&rdquo;</strong>.
        Create your free account here, then ${sender} will send you a separate
        private link or unlock code to open it. The ${noun} stays sealed until
        you have that.
      </p>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:9px;">
          Create your free account
        </a>
      </div>
      <p style="font-size:13px;line-height:1.6;color:#6b7280;text-align:center;margin:0;">
        ResearchOS is a free, open electronic lab notebook. Notes, methods, and
        data stay in your own folder, and sharing across labs is end-to-end
        encrypted.
      </p>
    </div>
    <div style="margin-top:18px;text-align:center;font-size:11px;line-height:1.6;color:#9ca3af;">
      <p style="margin:0 0 4px;">
        You received this because ${sender} chose to share a specific item with
        this address. The shared content is not in this email, it is parked
        encrypted until you open it.
      </p>
      <p style="margin:0 0 4px;">${esc(POSTAL_ADDRESS)}</p>
      <p style="margin:0;">
        <a href="${url}&unsubscribe=1" style="color:#9ca3af;">Do not invite me again</a>
        &nbsp;&middot;&nbsp;
        <a href="${url}&report=1" style="color:#9ca3af;">Report abuse</a>
      </p>
    </div>
  </div>
</body>
</html>`;
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
  return `${assetOrigin()}/?shared=1`;
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
  const mascotUrl = beakerbotImageUrl();
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px;">
        <tr>
          <td style="vertical-align:middle;padding-right:10px;">
            <img src="${mascotUrl}" width="48" height="48" alt="ResearchOS" style="display:block;width:48px;height:48px;border:0;outline:none;text-decoration:none;" />
          </td>
          <td style="vertical-align:middle;">
            <span style="font-size:22px;font-weight:700;color:#2563eb;letter-spacing:-0.01em;">ResearchOS</span>
          </td>
        </tr>
      </table>
      <h1 style="font-size:18px;font-weight:600;text-align:center;margin:8px 0 4px;">
        ${sender} invited you to collaborate
      </h1>
      <p style="font-size:14px;line-height:1.6;color:#4b5563;text-align:center;margin:0 0 20px;">
        ${sender} invited you to collaborate on
        <strong style="color:#111827;">&ldquo;${title}&rdquo;</strong> in
        ResearchOS. Open ResearchOS and go to Shared with me to accept.
      </p>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:9px;">
          Open ResearchOS
        </a>
      </div>
      <p style="font-size:13px;line-height:1.6;color:#6b7280;text-align:center;margin:0;">
        The invite is also waiting for you in ResearchOS under Shared with me.
        Nothing is shared until you accept it there.
      </p>
    </div>
    <div style="margin-top:18px;text-align:center;font-size:11px;line-height:1.6;color:#9ca3af;">
      <p style="margin:0 0 4px;">
        You received this because you opted in to collaboration-invite emails and
        ${sender} invited you to collaborate. You can turn these off in
        ResearchOS under Settings, Sharing.
      </p>
      <p style="margin:0 0 4px;">${esc(POSTAL_ADDRESS)}</p>
    </div>
  </div>
</body>
</html>`;
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
