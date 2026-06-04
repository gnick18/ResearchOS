// Cross-boundary sharing, relay inbox-listing route (Phase 2a-ii).
//
// POST a RECIPIENT's signed request (action "inbox"). The relay verifies the
// caller's Ed25519 signature, then returns the metadata of their non-expired
// pending bundles, never any content. The caller can only list their own inbox,
// the listing is keyed by the hash derived from the signed-and-verified email,
// so a signature does not let one user read another user's mailbox.
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
  listInboxByRecipient,
  sweepStalePending,
} from "@/lib/sharing/relay/db";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "inbox failed" } as const;

// Grace window for an unconfirmed pending row before the listing sweeps it. Set
// well beyond the presigned-URL lifetime (storage DEFAULT_PRESIGN_TTL_SECONDS,
// five minutes) so a slow but legitimate upload is never swept mid-flight, while
// an abandoned upload self-cleans on the recipient's next inbox load.
const PENDING_GRACE_SECONDS = 15 * 60;

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

  const verified = await verifyRelayRequest(body, "inbox", getPepper());
  if (!verified) {
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

  // Sweep this recipient's abandoned pending rows (uploads that were never
  // confirmed past the grace window) before listing, so a failed send self-cleans
  // and never lingers as a phantom reservation.
  await sweepStalePending(verified.emailHash, PENDING_GRACE_SECONDS);

  // The listing is keyed by the caller's own verified hash, so it only ever
  // returns their mailbox. Metadata only, the sealed bytes are never exposed. The
  // listing already returns "ready" rows only, so any unswept (within-grace)
  // pending row stays hidden too.
  const entries = await listInboxByRecipient(verified.emailHash);
  const items = entries.map((e) => ({
    bundleId: e.bundleId,
    senderEmailHash: e.senderEmailHash,
    sizeBytes: e.sizeBytes,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
  }));

  return json(200, { items });
}
