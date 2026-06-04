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
  ensureRelaySchema,
  markInboxEntryReady,
} from "@/lib/sharing/relay/db";

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
  const flipped = await markInboxEntryReady(
    verified.parsed.bundleId,
    verified.emailHash,
  );
  if (!flipped) {
    return json(400, GENERIC_FAILURE);
  }

  return json(200, { ok: true });
}
