// Cross-boundary sharing, relay fetch route (Phase 2a-ii).
//
// POST a RECIPIENT's signed request (action "fetch") carrying a bundleId. The
// relay verifies the caller's Ed25519 signature, confirms the bundle is
// addressed to them, and hands back a short-lived presigned GET URL the client
// uses to download the sealed bytes directly from R2. If the row has passed its
// 30-day TTL the relay sweeps it (deletes the R2 object and the metadata row)
// and returns 410 Gone. The relay never reads the bytes.
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
import { deleteObject, presignDownload } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "fetch failed" } as const;

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

  const verified = await verifyRelayRequest(body, "fetch", getPepper());
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
  // Ownership check, the row must belong to the verified caller. A non-existent
  // row and a row owned by someone else both return the same generic failure so
  // a caller cannot probe for the existence of another user's bundle.
  if (!entry || entry.recipientEmailHash !== verified.emailHash) {
    return json(400, GENERIC_FAILURE);
  }

  // Expired entry, sweep it (delete the object and the row) and report 410. The
  // listing already hides expired rows, this guards a stale bundleId held by a
  // client that listed before expiry.
  if (new Date(entry.expiresAt).getTime() <= Date.now()) {
    await deleteObject(entry.bundleId);
    await deleteInboxEntry(entry.bundleId);
    return json(410, { error: "bundle expired" });
  }

  const downloadUrl = await presignDownload(entry.bundleId);
  return json(200, { downloadUrl });
}
