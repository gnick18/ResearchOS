// Cross-boundary sharing, relay confirm-upload route (confirm-after-upload fix).
//
// POST a SENDER's signed request (action "confirm") carrying a bundleId. The
// send route reserves a bundle id and inserts the mailbox row as "pending", then
// hands back a presigned PUT URL. Once the client has uploaded the sealed bytes
// to R2 it calls this route, which verifies the caller's Ed25519 signature,
// confirms the bundle was reserved by that same sender, and flips the row to
// "ready". Only "ready" rows are listed or fetchable, so a failed or abandoned
// upload (CSP, CORS, a closed tab) never leaves a phantom row the recipient can
// see but cannot open. The flip is scoped to the reserving sender and to a still
// "pending" row, so it cannot confirm another user's bundle and a duplicate
// confirm is a harmless no-op.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN.

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
  deleteInboxEntry,
  ensureRelaySchema,
  getInboxEntry,
  markInboxEntryReady,
  sumPendingBytesByRecipient,
  updateInboxSize,
} from "@/lib/sharing/relay/db";
import { FREE_STORAGE_BYTES } from "@/lib/sharing/relay/limits";
import { deleteObject, headObjectSize } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "confirm failed" } as const;

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

  const verified = await verifyRelayRequest(body, "confirm", getPepper());
  if (!verified || !verified.parsed.bundleId) {
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

  // Flip the pending row to ready, scoped to the verified sender. A false result
  // means there was no matching pending row reserved by this sender (a wrong
  // bundle id, someone else's bundle, or an already-confirmed one), all of which
  // collapse to the same generic failure so nothing about another user's mailbox
  // leaks.
  const bundleId = verified.parsed.bundleId;
  const flipped = await markInboxEntryReady(bundleId, verified.emailHash);
  if (!flipped) {
    return json(400, GENERIC_FAILURE);
  }

  // AUTHORITATIVE SIZE RECONCILE. The send route stored the sender's SIGNED size
  // claim and bound the presigned PUT to it, but we do not trust that the upload
  // actually matched, the byte budget must be enforced against the REAL object.
  // Read the true size back from R2 and reconcile before the share is allowed to
  // stand.
  const row = await getInboxEntry(bundleId);
  if (!row) {
    // The row vanished between the flip and the read (a concurrent sweep / ack).
    // Nothing to stand behind, fail closed.
    return json(400, GENERIC_FAILURE);
  }

  let trueSize: number | null;
  try {
    trueSize = await headObjectSize(bundleId);
  } catch {
    // R2 HEAD is transiently unavailable. The size-bound presign already forced
    // the upload to match the declared (already-budgeted) size, so the row's
    // stored size is trustworthy, leave the confirmed share as-is rather than
    // failing a legitimate send on a storage blip.
    return json(200, { ok: true });
  }

  if (trueSize === null) {
    // No object was ever uploaded for this bundle. A "ready" row pointing at a
    // missing object would only error on the recipient's open, so drop it and
    // fail the confirm (the client should upload before confirming).
    await deleteInboxEntry(bundleId);
    return json(400, GENERIC_FAILURE);
  }

  // Correct the stored size to the real one (the claim is now irrelevant), then
  // re-check the recipient's byte budget against the true total. With the
  // size-bound presign this is normally a no-op, it is the backstop for the case
  // where the real upload still exceeded the declared size and pushed the
  // recipient over budget. If so, roll the whole share back, object and row.
  await updateInboxSize(bundleId, trueSize);
  const total = await sumPendingBytesByRecipient(row.recipientEmailHash);
  if (total > FREE_STORAGE_BYTES) {
    await deleteObject(bundleId);
    await deleteInboxEntry(bundleId);
    return json(429, { error: "recipient mailbox is full" });
  }

  return json(200, { ok: true });
}
