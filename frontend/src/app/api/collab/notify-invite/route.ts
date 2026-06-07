// External-collab, the optional invite-NOTIFICATION email route.
//
// POST /api/collab/notify-invite
//   Body: { from: { email, pubkey }, recipientEmail, noteTitle, issuedAt, signature }
//
// The SENDER (owner) triggers this after a successful external-collab grant, but
// the email must respect the RECIPIENT's preference, so the decision is made
// server-side from the recipient's published directory profile, never from
// browser-local state. The recipient is already a registered user with an in-app
// inbox invite, so this email is just a NUDGE (no secret key, no accept token).
//
// VERIFICATION (anti-spam, ties the send to a real key):
//   1. EXTERNAL_COLLAB_ENABLED + SHARING_ENABLED gates (404 when dark).
//   2. Per-IP backstop limit.
//   3. Freshness: issuedAt within the relay freshness window.
//   4. Owner Ed25519 signature over `notify-invite\n<recipient>\n<title>\n<issuedAt>`
//      verified against from.pubkey, AND from.pubkey must match the Ed25519 key
//      the directory has bound to from.email (so a request cannot present an
//      arbitrary key).
//   5. Per-sender and per-recipient daily rate limits.
//   6. The recipient must be a REGISTERED user (directory binding exists). Never
//      email a non-registered address.
//   7. Look up the recipient's profile. If notifyOnCollabInvite is false, return
//      200 { sent: false } WITHOUT sending. If true, send a content-minimized
//      nudge (sender + title only) via the shared mailer.
//
// CONTENT MINIMIZATION. The email carries only the sender label and the note
// title the sender already chose to expose (same precedent as the send-outside
// invite). No research content, no secret link.
//
// Reads env: EXTERNAL_COLLAB_ENABLED is a build-time constant; SHARING_ENABLED,
// DIRECTORY_HMAC_PEPPER, DATABASE_URL, KV_REST_API_*, RESEND_API_KEY.

import { hexToBytes } from "@noble/hashes/utils.js";

import { EXTERNAL_COLLAB_ENABLED } from "@/lib/loro/config";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import {
  buildNotifyInvitePayload,
  verifyBindingSignature,
} from "@/lib/sharing/directory/signature";
import {
  ensureProfileSchema,
  ensureSchema,
  getBindingByHash,
  getProfileByFingerprint,
} from "@/lib/sharing/directory/db";
import {
  getCollabNotifyRecipientLimiter,
  getCollabNotifySenderLimiter,
  getRelayIpBackstopLimiter,
} from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { isFresh } from "@/lib/sharing/relay/auth";
import { sendCollabInviteEmail } from "@/lib/sharing/relay/mailer";

export const runtime = "nodejs";

// One generic failure for any rejected request, so a caller cannot distinguish a
// malformed body from a bad signature from a missing binding.
const GENERIC_FAILURE = { error: "notify failed" } as const;

const HEX_64BYTE = /^[0-9a-f]{128}$/;
const HEX_32BYTE = /^[0-9a-f]{64}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The validated, canonicalized notify-invite body. */
interface ParsedNotify {
  fromEmail: string;
  fromPubkey: string;
  recipientEmail: string;
  noteTitle: string;
  issuedAt: string;
  signature: string;
}

/** Parses + canonicalizes the body. Returns null on any shape failure. */
function parseBody(body: unknown): ParsedNotify | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const from = b.from;
  if (typeof from !== "object" || from === null) return null;
  const f = from as Record<string, unknown>;

  if (typeof f.email !== "string" || !EMAIL_RE.test(f.email.trim())) return null;
  if (typeof f.pubkey !== "string" || !HEX_32BYTE.test(f.pubkey)) return null;
  if (
    typeof b.recipientEmail !== "string" ||
    !EMAIL_RE.test(b.recipientEmail.trim())
  ) {
    return null;
  }
  if (typeof b.noteTitle !== "string") return null;
  const noteTitle = b.noteTitle.trim();
  if (noteTitle.length === 0 || noteTitle.length > 300) return null;
  if (typeof b.issuedAt !== "string" || b.issuedAt.length === 0) return null;
  if (typeof b.signature !== "string" || !HEX_64BYTE.test(b.signature)) {
    return null;
  }

  return {
    fromEmail: canonicalizeEmail(f.email),
    fromPubkey: f.pubkey,
    recipientEmail: canonicalizeEmail(b.recipientEmail),
    noteTitle,
    issuedAt: b.issuedAt,
    signature: b.signature,
  };
}

export async function POST(request: Request): Promise<Response> {
  // The whole external-collab arc is dark until the flag flips, so this route
  // 404s exactly like the directory routes do when sharing is off.
  if (!EXTERNAL_COLLAB_ENABLED || !isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getRelayIpBackstopLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseBody(body);
  if (!parsed) {
    return json(400, GENERIC_FAILURE);
  }

  // Freshness: reject a stale or future-dated request (replay window).
  if (!isFresh(parsed.issuedAt)) {
    return json(400, GENERIC_FAILURE);
  }

  // Verify the owner signature over the canonical bytes against from.pubkey.
  const payload = buildNotifyInvitePayload({
    recipientEmail: parsed.recipientEmail,
    noteTitle: parsed.noteTitle,
    issuedAt: parsed.issuedAt,
  });
  let sigOk = false;
  try {
    sigOk = verifyBindingSignature(
      payload,
      hexToBytes(parsed.signature),
      hexToBytes(parsed.fromPubkey),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return json(400, GENERIC_FAILURE);
  }

  const pepper = getPepper();
  await ensureSchema();

  // Tie the presented key to a REAL directory identity: from.pubkey must be the
  // Ed25519 key the directory has bound to from.email. This stops a caller from
  // signing with a throwaway key and claiming to be someone else.
  const senderHash = hashEmail(parsed.fromEmail, pepper);
  const senderBinding = await getBindingByHash(senderHash);
  if (!senderBinding || senderBinding.ed25519PublicKey !== parsed.fromPubkey) {
    return json(400, GENERIC_FAILURE);
  }

  // The recipient must be a registered user. Never email a non-registered
  // address. A missing binding collapses into the generic failure.
  const recipientHash = hashEmail(parsed.recipientEmail, pepper);
  const recipientBinding = await getBindingByHash(recipientHash);
  if (!recipientBinding) {
    return json(400, GENERIC_FAILURE);
  }

  // Rate limit per sender and per recipient (anti-spam + anti-harassment).
  const senderVerdict = await getCollabNotifySenderLimiter().limit(senderHash);
  if (!senderVerdict.success) {
    return json(429, { error: "rate limited" });
  }
  const recipientVerdict =
    await getCollabNotifyRecipientLimiter().limit(recipientHash);
  if (!recipientVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  // Respect the recipient's published preference. No profile means no opt-out
  // signal was ever published, so the default-true preference applies.
  await ensureProfileSchema();
  const recipientProfile = await getProfileByFingerprint(
    recipientBinding.fingerprint,
  );
  const wantsEmail = recipientProfile?.notifyOnCollabInvite ?? true;
  if (!wantsEmail) {
    return json(200, { sent: false });
  }

  // Content-minimized nudge: sender label + title only, no research content, no
  // secret link. Prefer the sender's published display name, fall back to the
  // sender's email when no profile is published.
  let senderLabel = parsed.fromEmail;
  try {
    const senderProfile = await getProfileByFingerprint(
      senderBinding.fingerprint,
    );
    if (senderProfile?.displayName) {
      senderLabel = senderProfile.displayName;
    }
  } catch {
    // A profile lookup failure just falls back to the email label.
  }

  try {
    await sendCollabInviteEmail({
      toEmail: parsed.recipientEmail,
      senderLabel,
      noteTitle: parsed.noteTitle,
    });
  } catch {
    // A send failure is reported as a generic failure so the caller does not
    // claim a delivered email. The grant flow swallows this (best-effort).
    return json(502, GENERIC_FAILURE);
  }

  return json(200, { sent: true });
}
