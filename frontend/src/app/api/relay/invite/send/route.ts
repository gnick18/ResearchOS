// Cross-boundary sharing, relay INVITE send route (invite-a-non-user loop).
//
// POST a SENDER's signed request (action "invite") carrying recipientEmail and
// sizeBytes. Unlike /api/relay/send (which requires the recipient to be a
// registered ResearchOS identity), this is the keyless growth-loop path, the
// recipient is NOT on ResearchOS yet. The relay verifies the sender's Ed25519
// signature, enforces a per-sender invite rate limit (so we cannot be a spam
// relay) plus a per-sender pending-invite cap, reserves a server-generated
// invite id, and hands back a short-lived presigned PUT URL. The client uploads
// the sealed (one-time-key encrypted) bytes directly to R2 with that URL, the
// bytes never transit this function and the relay can never read them.
//
// CONFIRM-AFTER-UPLOAD. The pending-invite row is inserted as "pending" and is
// not fetchable (and no email is sent) until the client confirms the upload
// (POST /api/relay/invite/confirm), which flips it to "ready" AND triggers the
// branded email. Sending the email only after the upload confirms is what keeps
// an abandoned upload from producing a dead accept link in someone's inbox.
//
// KEY HANDLING. The one-time decryption key is NEVER sent here. It lives only in
// the accept-link fragment the CLIENT composes (see the client + confirm route).
// This route, the relay row, and the logs never see it.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, R2_*.

import {
  canonicalizeEmail,
  hashEmail,
} from "@/lib/sharing/directory/email";
import {
  getInviteLimiter,
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
import { isBillingEnabled } from "@/lib/billing/config";
import { isProduceEntitled } from "@/lib/billing/model-a/resolve";
import {
  countInvitesBySender,
  ensureInviteSchema,
  insertInviteEntry,
  sumPendingInviteBytesByRecipient,
} from "@/lib/sharing/relay/db";
import {
  INVITE_FREE_STORAGE_BYTES,
  PENDING_INVITE_CAP,
  TTL_MS,
} from "@/lib/sharing/relay/limits";
import { presignUpload } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

// One generic failure for any rejected invite, the caller cannot tell a bad
// signature from a stale request from an unregistered sender.
const GENERIC_FAILURE = { error: "invite failed" } as const;

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

  // Verify the SENDER's signature over the canonical "invite" payload. A null
  // result is a bad shape, a stale request, an unregistered sender, or a bad
  // signature, all collapse to one generic error.
  const verified = await verifyRelayRequest(body, "invite", getPepper());
  if (
    !verified ||
    !verified.parsed.recipientEmail ||
    verified.parsed.sizeBytes === undefined
  ) {
    return json(400, GENERIC_FAILURE);
  }

  // The signed size must be a real, positive byte count. auth.parseRelayBody
  // already rejects negatives / fractions / non-integers but permits zero, and a
  // declared zero is both meaningless for a sealed payload and the "no size
  // claimed" sentinel for the size-bound presign below. A genuine sealed invite is
  // always at least a few bytes, so reject a sub-1 size as a generic failure.
  const declaredBytes = verified.parsed.sizeBytes;
  if (declaredBytes < 1) {
    return json(400, GENERIC_FAILURE);
  }

  // PRIMARY per-request rate limit, keyed by the verified SENDER identity (email
  // hash), not the IP, so legitimate signed callers behind one shared NAT do not
  // collide. This is the high-volume per-minute gate. The per-day invite limiter
  // below is a separate, much stricter anti-spam-relay cap on NEW invites.
  const identityVerdict = await getRelayIdentityLimiter().limit(
    verified.emailHash,
  );
  if (!identityVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  // Model A produce gate: inviting a non-user IS a send (the sender seals a copy
  // and parks it on the relay), so it is the paid produce side just like
  // /api/relay/send. Once billing is live a FREE sender cannot invite-and-send. A
  // free member of a paid lab still can, the PI covers them (isProduceEntitled
  // resolves member -> PI). Returns 402 so the client surfaces the upgrade nudge.
  // Entirely inert while billing is off, so the beta is byte-for-byte unchanged.
  if (isBillingEnabled() && !(await isProduceEntitled(verified.emailHash))) {
    return json(402, { error: "upgrade required", reason: "send-is-paid" });
  }

  // Per-sender invite RATE LIMIT (keyed by the sender's email hash, not IP, so it
  // follows the identity across networks). This is the anti-spam-relay control,
  // an authenticated user can only invite a bounded number of new addresses per
  // day.
  const inviteVerdict = await getInviteLimiter().limit(verified.emailHash);
  if (!inviteVerdict.success) {
    return json(429, { error: "invite limit reached" });
  }

  // Secondary per-sender ceiling, the count of outstanding non-expired invites.
  // Together with the rate limit this bounds the backlog a sender can park.
  const outstanding = await countInvitesBySender(verified.emailHash);
  if (outstanding >= PENDING_INVITE_CAP) {
    return json(429, { error: "too many pending invites" });
  }

  // The recipient is hashed only for metadata accounting and de-dup, never stored
  // in plaintext, mirroring the relay's data-minimization stance. There is NO
  // directory lookup here, the whole point of an invite is that the recipient is
  // not registered.
  const recipientCanonical = canonicalizeEmail(verified.parsed.recipientEmail);
  const recipientHash = hashEmail(recipientCanonical, getPepper());

  // Per-RECIPIENT BYTE budget, mirroring the send path's FREE_STORAGE_BYTES gate
  // (here the smaller, dedicated INVITE_FREE_STORAGE_BYTES, see limits.ts for why
  // the invite path earns a tighter ceiling). The per-sender count cap and rate
  // limiter above bound how many invites one sender parks, this orthogonal axis
  // bounds the total sealed bytes parked under one recipient hash across every
  // sender that targets it. Reject when the recipient's existing non-expired
  // invite bytes plus this incoming bundle would exceed the budget. The size is
  // the sender-reported sealed size, the same value stored on the row, so the
  // running sum and this check use the same number. The presign below binds the
  // upload to exactly this many bytes, and the confirm route re-reads the true
  // object size from R2 and re-checks this budget, so a false claim cannot stick.
  const existingInviteBytes = await sumPendingInviteBytesByRecipient(
    recipientHash,
  );
  if (existingInviteBytes + declaredBytes > INVITE_FREE_STORAGE_BYTES) {
    return json(429, { error: "recipient mailbox is full" });
  }

  // The invite id is server-generated, never client-chosen, so a sender cannot
  // target or overwrite an existing object. It doubles as the R2 object key and
  // the bearer id the accept page presents.
  const inviteId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  await insertInviteEntry({
    inviteId,
    recipientEmailHash: recipientHash,
    senderEmailHash: verified.emailHash,
    sizeBytes: verified.parsed.sizeBytes,
    expiresAt,
  });

  // Bind the presigned PUT to exactly the declared size so the real upload cannot
  // exceed what was claimed. Together with the per-recipient byte budget checked
  // above and the confirm-time true-size re-check, this keeps a
  // 0-claim-then-upload-huge (and a within-budget-claim-then-upload-bigger) from
  // quietly parking unbudgeted bytes on R2.
  const uploadUrl = await presignUpload(inviteId, declaredBytes);

  return json(200, { inviteId, uploadUrl, expiresAt });
}
