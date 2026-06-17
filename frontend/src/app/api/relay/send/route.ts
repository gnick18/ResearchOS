// Cross-boundary sharing, relay send route (Phase 2a-ii).
//
// POST a SENDER's signed request (action "send") carrying recipientEmail and
// sizeBytes. The relay verifies the sender's Ed25519 signature, confirms the
// recipient is a registered ResearchOS identity (registered-to-registered only,
// there is no email-invite path), enforces a per-recipient mailbox quota, then
// reserves a server-generated bundle id and hands back a short-lived presigned
// PUT URL. The client uploads the sealed (end-to-end encrypted) bytes directly
// to R2 with that URL, the bytes never transit this function and the relay can
// never read them. The mailbox row carries metadata only and self-expires after
// 30 days.
//
// CONFIRM-AFTER-UPLOAD. The row is inserted as "pending" and is invisible to the
// recipient until the client confirms the upload (POST /api/relay/confirm), which
// flips it to "ready". This is what keeps a failed or abandoned upload from
// leaving a phantom inbox row that errors on open. The bundle id and the presign
// still have to be issued here, before the upload can happen, so the row must
// exist now, it just stays hidden until the bytes are really in R2.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, R2_*.

import {
  canonicalizeEmail,
  hashEmail,
} from "@/lib/sharing/directory/email";
import {
  getBindingByHash,
  getBindingByFingerprint,
} from "@/lib/sharing/directory/db";
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
import { isBillingEnabled } from "@/lib/billing/config";
import { isProduceEntitled } from "@/lib/billing/model-a/resolve";
import { verifyRelayRequest } from "@/lib/sharing/relay/auth";
import {
  countInboxByRecipient,
  ensureRelaySchema,
  insertInboxEntry,
  sumPendingBytesByRecipient,
} from "@/lib/sharing/relay/db";
import {
  FREE_STORAGE_BYTES,
  PENDING_SHARE_CAP,
  TTL_MS,
} from "@/lib/sharing/relay/limits";
import { presignUpload } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

// One generic failure for any rejected send, the caller cannot tell a bad
// signature from a stale request from an unregistered sender.
const GENERIC_FAILURE = { error: "send failed" } as const;

// The pending-count cap, the byte budget, and the TTL are shared constants in
// relay/limits.ts so this enforcement and the Settings "Inbox and storage"
// display can never drift. PENDING_SHARE_CAP replaces the former in-file
// RECIPIENT_QUOTA (bumped 50 -> 100, Grant 2026-06-03; byte budget later
// lowered 5 GB -> 1 GB, Grant 2026-06-05).

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

  await ensureRelaySchema();

  // Verify the sender's signature over the canonical "send" payload. A null
  // result is a bad shape, a stale request, an unregistered sender, or a bad
  // signature, all collapse to one generic error.
  const verified = await verifyRelayRequest(body, "send", getPepper());
  if (
    !verified ||
    verified.parsed.sizeBytes === undefined ||
    (!verified.parsed.recipientEmail && !verified.parsed.recipientFingerprint)
  ) {
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

  // Model A produce gate: SENDING is the paid produce side (the sender pays the
  // relay), so once billing is live a FREE sender cannot send. A free member of a
  // paid lab still can, the PI covers them (isProduceEntitled resolves member ->
  // PI). Returns 402 so the client surfaces the gentle upgrade nudge. Entirely
  // inert while billing is off, so the beta is byte-for-byte unchanged.
  if (isBillingEnabled() && !(await isProduceEntitled(verified.emailHash))) {
    return json(402, { error: "upgrade required", reason: "send-is-paid" });
  }

  // Resolve the recipient via the directory. Registered-to-registered only, an
  // absent binding means the recipient is not on ResearchOS, returned as a clear
  // distinct result (not the generic failure) so the client can tell the sender.
  // Resolve the recipient to their mailbox hash. A fingerprint-addressed send (the
  // no-email /network path) resolves via the directory to a LISTED researcher's
  // hash, so the sender never learns the recipient's email; an email-addressed send
  // hashes the email as before. Either way an absent binding means the recipient is
  // not on ResearchOS (returned distinctly so the client can tell the sender).
  let recipientHash: string;
  if (verified.parsed.recipientFingerprint) {
    const recipientBinding = await getBindingByFingerprint(
      verified.parsed.recipientFingerprint,
    );
    if (!recipientBinding) {
      return json(404, { error: "recipient is not on ResearchOS" });
    }
    recipientHash = recipientBinding.emailHash;
  } else {
    const recipientCanonical = canonicalizeEmail(verified.parsed.recipientEmail!);
    recipientHash = hashEmail(recipientCanonical, getPepper());
    const recipientBinding = await getBindingByHash(recipientHash);
    if (!recipientBinding) {
      return json(404, { error: "recipient is not on ResearchOS" });
    }
  }

  // Per-recipient mailbox COUNT cap. Together with the per-IP rate limit this also
  // bounds the blast radius of any replay inside the 5-minute signature window.
  const pending = await countInboxByRecipient(recipientHash);
  if (pending >= PENDING_SHARE_CAP) {
    return json(429, { error: "recipient mailbox is full" });
  }

  // The signed size must be a real, positive byte count. auth.parseRelayBody
  // already rejects negatives / fractions / non-integers, but it permits zero,
  // and a declared zero would both pass the byte budget unconditionally AND, via
  // the size-bound presign below, would otherwise be the "no size claimed" case.
  // A genuine sealed bundle is always at least a few bytes, so a sub-1 size is
  // either malformed or a deliberate budget-dodge, reject it as a generic failure.
  const incomingBytes = verified.parsed.sizeBytes ?? 0;
  if (incomingBytes < 1) {
    return json(400, GENERIC_FAILURE);
  }

  // Per-recipient BYTE budget. The count cap and the byte budget are two
  // independent ceilings, whichever fills first stops new shares to a recipient.
  // Reject when the recipient's existing non-expired bytes plus this incoming
  // bundle would exceed the free budget. The size is the sender-reported sealed
  // size, the same value stored on the row, so the running sum and this check use
  // the same number. The presign below binds the upload to exactly this many
  // bytes, and the confirm route re-reads the true object size from R2 and
  // re-checks this budget, so a false claim cannot stick.
  const existingBytes = await sumPendingBytesByRecipient(recipientHash);
  if (existingBytes + incomingBytes > FREE_STORAGE_BYTES) {
    return json(429, { error: "recipient mailbox is full" });
  }

  // The bundle id is server-generated, never client-chosen, so a sender cannot
  // target or overwrite an existing object. It doubles as the R2 object key.
  const bundleId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  await insertInboxEntry({
    bundleId,
    recipientEmailHash: recipientHash,
    senderEmailHash: verified.emailHash,
    sizeBytes: verified.parsed.sizeBytes,
    expiresAt,
  });

  // Bind the presigned PUT to exactly the declared size so the real upload cannot
  // exceed (or fall short of) what was budgeted above. See presignUpload.
  const uploadUrl = await presignUpload(bundleId, incomingBytes);

  return json(200, { bundleId, uploadUrl, expiresAt });
}
