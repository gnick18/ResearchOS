// Cross-boundary sharing, relay acknowledge (delete-on-pickup) route (Phase 2a-ii).
//
// POST a RECIPIENT's signed request (action "ack") carrying a bundleId. After
// the client has downloaded and filed the bundle locally it acknowledges pickup,
// which deletes the sealed bytes from R2 and removes the metadata row. This is
// the delete-on-pickup half of the model, the 30-day TTL is only the backstop
// for a bundle that is never picked up. The relay verifies the caller's Ed25519
// signature and confirms the bundle is addressed to them before deleting.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, R2_*.

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
} from "@/lib/sharing/relay/db";
import { deleteObject } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "ack failed" } as const;

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

  const verified = await verifyRelayRequest(body, "ack", getPepper());
  if (!verified || !verified.parsed.bundleId) {
    return json(400, GENERIC_FAILURE);
  }

  // PRIMARY rate limit, keyed by the verified caller identity (email hash), not
  // the IP. Applied AFTER verification so the budget follows the user across
  // shared IPs and multiple tabs/devices rather than being shared by everyone
  // behind one NAT.
  const identityVerdict = await getRelayIdentityLimiter().limit(
    verified.emailHash,
  );
  if (!identityVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  const entry = await getInboxEntry(verified.parsed.bundleId);
  // Ownership check, same generic failure for a missing row and a row owned by
  // someone else so ack cannot be used to probe or delete another user's bundle.
  if (!entry || entry.recipientEmailHash !== verified.emailHash) {
    return json(400, GENERIC_FAILURE);
  }

  // Delete the object first, then the row. Both are idempotent, so a retry after
  // a partial failure converges. The row is the source of truth for "still
  // pending", removing it last means a crash between the two leaves an orphaned
  // (already-deleted) object referenced by a row that the next ack or the TTL
  // sweep will clean up.
  await deleteObject(entry.bundleId);
  await deleteInboxEntry(entry.bundleId);

  return json(200, { ok: true });
}
