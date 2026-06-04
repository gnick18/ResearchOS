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
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, R2_*.

import {
  canonicalizeEmail,
  hashEmail,
} from "@/lib/sharing/directory/email";
import { getBindingByHash } from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { verifyRelayRequest } from "@/lib/sharing/relay/auth";
import {
  countInboxByRecipient,
  ensureRelaySchema,
  insertInboxEntry,
} from "@/lib/sharing/relay/db";
import { presignUpload } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

// One generic failure for any rejected send, the caller cannot tell a bad
// signature from a stale request from an unregistered sender.
const GENERIC_FAILURE = { error: "send failed" } as const;

/** Maximum pending bundles a single recipient mailbox may hold at once. */
const RECIPIENT_QUOTA = 50;

/** Pending-bundle lifetime, 30 days in milliseconds. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

  await ensureRelaySchema();

  // Verify the sender's signature over the canonical "send" payload. A null
  // result is a bad shape, a stale request, an unregistered sender, or a bad
  // signature, all collapse to one generic error.
  const verified = await verifyRelayRequest(body, "send", getPepper());
  if (!verified || !verified.parsed.recipientEmail ||
      verified.parsed.sizeBytes === undefined) {
    return json(400, GENERIC_FAILURE);
  }

  // Resolve the recipient via the directory. Registered-to-registered only, an
  // absent binding means the recipient is not on ResearchOS, returned as a clear
  // distinct result (not the generic failure) so the client can tell the sender.
  const recipientCanonical = canonicalizeEmail(verified.parsed.recipientEmail);
  const recipientHash = hashEmail(recipientCanonical, getPepper());
  const recipientBinding = await getBindingByHash(recipientHash);
  if (!recipientBinding) {
    return json(404, { error: "recipient is not on ResearchOS" });
  }

  // Per-recipient mailbox quota. Together with the per-IP rate limit this also
  // bounds the blast radius of any replay inside the 5-minute signature window.
  const pending = await countInboxByRecipient(recipientHash);
  if (pending >= RECIPIENT_QUOTA) {
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

  const uploadUrl = await presignUpload(bundleId);

  return json(200, { bundleId, uploadUrl, expiresAt });
}
