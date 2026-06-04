// Cross-boundary sharing, relay INVITE confirm route (invite-a-non-user loop).
//
// POST a SENDER's signed request (action "invite-confirm") carrying an inviteId,
// plus the UNSIGNED delivery fields the branded email needs (the recipient's
// plaintext address, the sender's display label, the item title, and the full
// accept URL with its fragment key). The send route reserved the invite as
// "pending" and handed back a presigned PUT; once the client has uploaded the
// sealed bytes it calls this route, which verifies the sender's signature,
// flips the row to "ready" scoped to that sender, and ONLY THEN sends the
// branded email. Sending after the upload confirms is what stops an abandoned
// upload from producing a dead accept link in someone's inbox.
//
// WHY THE DELIVERY FIELDS ARE NOT SIGNED. The signed payload binds the inviteId
// (the capability being confirmed) and the sender identity. The recipient email,
// the title, and the accept URL are delivery details the same authenticated
// sender supplies, the signature already proves who is sending, and the relay
// never stores any of them, it composes the email and discards them. The accept
// URL carries the one-time key in its fragment, and this route uses it ONLY to
// build the email body, it is never persisted and never logged.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY.

import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { verifyRelayRequest } from "@/lib/sharing/relay/auth";
import { ensureInviteSchema, markInviteReady } from "@/lib/sharing/relay/db";
import { sendInviteEmail } from "@/lib/sharing/relay/mailer";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "invite confirm failed" } as const;

/** A loose email shape check for the unsigned recipient delivery field. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
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

  // Pull the unsigned delivery fields. These are validated for shape but not part
  // of the signature (see the header note). A missing or malformed field fails
  // the confirm before any state change, so we never flip a row we then cannot
  // deliver for.
  const b = (body ?? {}) as Record<string, unknown>;
  const recipientEmailRaw = b.recipientEmail;
  const senderLabel = b.senderLabel;
  const itemTitle = b.itemTitle;
  const acceptUrl = b.acceptUrl;
  if (
    !nonEmptyString(recipientEmailRaw) ||
    !EMAIL_RE.test(recipientEmailRaw.trim()) ||
    !nonEmptyString(senderLabel) ||
    typeof itemTitle !== "string" ||
    !nonEmptyString(acceptUrl)
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

  // Send the branded email LAST, after the row is ready and fetchable. If the
  // send throws (Resend misconfigured, unverified domain), the invite is already
  // parked and ready, the client can surface a "we could not email them" state.
  // We deliberately do not roll back the ready flip, the data is safely parked
  // and a retry of the email is possible without re-uploading.
  try {
    await sendInviteEmail({
      toEmail: recipientEmailRaw.trim(),
      senderLabel: senderLabel.trim(),
      itemTitle: itemTitle,
      acceptUrl: acceptUrl,
    });
  } catch (err) {
    // Do not log the acceptUrl (it carries the fragment key). Log only that the
    // send failed.
    console.error("[invite] branded email send failed");
    void err;
    return json(502, { error: "invite parked but email could not be sent" });
  }

  return json(200, { ok: true });
}
