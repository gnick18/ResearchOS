// Cross-boundary sharing, relay INVITE confirm route (invite-a-non-user loop).
//
// POST a SENDER's signed request (action "invite-confirm") carrying an inviteId,
// plus the UNSIGNED delivery fields the branded email needs (the recipient's
// plaintext address, the sender's display label, and the item title). The send
// route reserved the invite as "pending" and handed back a presigned PUT; once
// the client has uploaded the sealed bytes it calls this route, which verifies
// the sender's signature, flips the row to "ready" scoped to that sender, and
// ONLY THEN sends the branded email. Sending after the upload confirms is what
// stops an abandoned upload from producing a dead accept link in someone's inbox.
//
// NO KEY REACHES THIS ROUTE (P1-A, docs/proposals/INVITE_KEY_OUT_OF_EMAIL.md).
// The branded email link is KEYLESS, a bare `${origin}/accept/<inviteId>` landing
// this route builds from the inviteId it already verified. The one-time
// decryption key never leaves the sender's browser to us, the sender delivers it
// to the recipient out of band (a private link or unlock code the client returns
// to the send-invite UI). This route therefore never sees, stores, or logs the
// key, which keeps it out of Resend's retained email-activity log.
//
// WHY THE DELIVERY FIELDS ARE NOT SIGNED. The signed payload binds the inviteId
// (the capability being confirmed) and the sender identity. The recipient email
// and the title are delivery details the same authenticated sender supplies, the
// signature already proves who is sending, and the relay never stores any of
// them, it composes the email and discards them.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY, NEXT_PUBLIC_APP_ORIGIN.

import {
  getRelayIdentityLimiter,
  getRelayIpBackstopLimiter,
} from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { verifyRelayRequest } from "@/lib/sharing/relay/auth";
import {
  deleteInviteEntry,
  ensureInviteSchema,
  markInviteReady,
  sumPendingInviteBytesByRecipient,
  updateInviteSize,
} from "@/lib/sharing/relay/db";
import { INVITE_FREE_STORAGE_BYTES } from "@/lib/sharing/relay/limits";
import { deleteObject, headObjectSize } from "@/lib/sharing/relay/storage";
import { sendInviteEmail, type InviteItemKind } from "@/lib/sharing/relay/mailer";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "invite confirm failed" } as const;

/** A loose email shape check for the unsigned recipient delivery field. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The item kinds the branded email can phrase. Anything else falls back to a note. */
const ITEM_KINDS: readonly InviteItemKind[] = [
  "note",
  "experiment",
  "method",
  "project",
  "sequence",
];

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * The absolute origin the keyless accept link points at, read from the SAME env
 * the client's acceptBaseUrl() and the mailer's assetOrigin() use, with the
 * canonical production default. Runs server-side, so there is no window fallback.
 * The link is KEYLESS (no fragment), so this carries no secret.
 */
function acceptOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured && configured.length > 0) return configured.replace(/\/$/, "");
  return "https://research-os.app";
}

/** Coerce the unsigned itemKind delivery field to a known kind, default "note". */
function coerceItemKind(v: unknown): InviteItemKind {
  return typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v)
    ? (v as InviteItemKind)
    : "note";
}

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // Loose per-IP backstop only, NOT the binding limit on legitimate signed
  // callers (a whole lab behind one NAT IP would otherwise share this budget).
  // It just blunts a flood of unsigned garbage before the signature check runs.
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

  await ensureInviteSchema();

  // Verify the sender's signature over the canonical "invite-confirm" payload
  // (which binds the inviteId). A null result collapses to a generic failure.
  const verified = await verifyRelayRequest(body, "invite-confirm", getPepper());
  if (!verified || !verified.parsed.inviteId) {
    return json(400, GENERIC_FAILURE);
  }

  // PRIMARY rate limit, keyed by the verified SENDER identity (email hash), not
  // the IP. Applied AFTER verification so the budget follows the user across
  // shared IPs and multiple tabs/devices rather than being shared by everyone
  // behind one NAT.
  const identityVerdict = await getRelayIdentityLimiter().limit(
    verified.emailHash,
  );
  if (!identityVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  // Pull the unsigned delivery fields. These are validated for shape but not part
  // of the signature (see the header note). A missing or malformed field fails
  // the confirm before any state change, so we never flip a row we then cannot
  // deliver for.
  const b = (body ?? {}) as Record<string, unknown>;
  const recipientEmailRaw = b.recipientEmail;
  const senderLabel = b.senderLabel;
  const itemTitle = b.itemTitle;
  // The item kind is an optional delivery hint for the email noun only. It is
  // not security-sensitive (it never gates fetch / decrypt), so an unknown or
  // missing value safely defaults to "note" rather than failing the confirm.
  const itemKind = coerceItemKind(b.itemKind);
  // NOTE there is deliberately no acceptUrl field. The client no longer sends it
  // (and never sends the key), this route builds the keyless link itself below.
  if (
    !nonEmptyString(recipientEmailRaw) ||
    !EMAIL_RE.test(recipientEmailRaw.trim()) ||
    !nonEmptyString(senderLabel) ||
    typeof itemTitle !== "string"
  ) {
    return json(400, GENERIC_FAILURE);
  }

  // Flip the pending invite to ready, scoped to the verified sender. A null
  // result means there was no matching pending invite reserved by this sender (a
  // wrong id, someone else's invite, or an already-confirmed one), all collapse
  // to the same generic failure so nothing about another sender's invites leaks.
  const flipped = await markInviteReady(
    verified.parsed.inviteId,
    verified.emailHash,
  );
  if (!flipped) {
    return json(400, GENERIC_FAILURE);
  }

  // AUTHORITATIVE SIZE RECONCILE. The invite-send route stored the sender's SIGNED
  // size claim and bound the presigned PUT to it. Read the true object size back
  // from R2 and reconcile before emailing the accept link, both to keep the stored
  // figure honest (R2 cost accounting, no per-recipient budget on the invite path)
  // and, more importantly, to refuse to email a deep link to a bundle that was
  // never actually uploaded.
  let trueSize: number | null = null;
  let headFailed = false;
  try {
    trueSize = await headObjectSize(flipped.inviteId);
  } catch {
    // R2 HEAD transiently unavailable. The size-bound presign already forced the
    // upload to match the declared size, so proceed with the email rather than
    // failing a legitimate invite on a storage blip, the stored size stays as the
    // (now upload-bound) claim.
    headFailed = true;
  }
  if (!headFailed) {
    if (trueSize === null) {
      // No object was ever uploaded for this invite. Do not email an accept link
      // that would 404 / 410 on open, drop the row and fail the confirm.
      await deleteInviteEntry(flipped.inviteId);
      return json(400, GENERIC_FAILURE);
    }
    // Correct the stored size to the real one, then re-check the recipient's byte
    // budget against the true total, mirroring the send confirm route. With the
    // size-bound presign this is normally a no-op, it is the backstop for the case
    // where the real upload still exceeded the declared size and pushed the
    // recipient hash over INVITE_FREE_STORAGE_BYTES. If so, roll the whole invite
    // back (object and row) and fail the confirm BEFORE any email is sent, so an
    // over-budget bundle never produces a live accept link.
    await updateInviteSize(flipped.inviteId, trueSize);
    const total = await sumPendingInviteBytesByRecipient(
      flipped.recipientEmailHash,
    );
    if (total > INVITE_FREE_STORAGE_BYTES) {
      await deleteObject(flipped.inviteId);
      await deleteInviteEntry(flipped.inviteId);
      return json(429, { error: "recipient mailbox is full" });
    }
  }

  // Send the branded email LAST, after the row is ready and fetchable. If the
  // send throws (Resend misconfigured, unverified domain), the invite is already
  // parked and ready, the client can surface a "we could not email them" state.
  // We deliberately do not roll back the ready flip, the data is safely parked
  // and a retry of the email is possible without re-uploading.
  try {
    // Build the KEYLESS accept link from the verified inviteId. No fragment, no
    // key, so nothing secret enters the email or Resend's retained log (P1-A).
    const acceptUrl = `${acceptOrigin()}/accept/${flipped.inviteId}`;
    await sendInviteEmail({
      toEmail: recipientEmailRaw.trim(),
      senderLabel: senderLabel.trim(),
      itemTitle: itemTitle,
      acceptUrl: acceptUrl,
      itemKind: itemKind,
    });
  } catch (err) {
    // The accept link is keyless, but keep the existing minimal log (no link, no
    // fields) for the same reason, the failure fact is all the operator needs.
    console.error("[invite] branded email send failed");
    void err;
    return json(502, { error: "invite parked but email could not be sent" });
  }

  return json(200, { ok: true });
}
