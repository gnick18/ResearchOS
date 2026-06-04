// Cross-boundary sharing, directory key-rotation route (Phase 1b-iii).
//
// POST { email, newX25519PublicKey, newEd25519PublicKey, signature, issuedAt,
// keyBackupBlob? }. Replaces the keys bound to an already registered identity.
//
// Authorization model, the rotation is signed by the user's CURRENT (old)
// Ed25519 key and verified against the key the directory already stores, so only
// whoever controls the existing signing key can publish a new key pair. There is
// no OTP here, the current key holder's signature over the new binding IS the
// proof. This is the directory's defense against a man in the middle swapping in
// their own keys (section 6 of docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md).
// Every failure returns one generic error so nothing about which step failed
// leaks.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN.

import { hexToBytes } from "@noble/hashes/utils.js";

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import {
  buildBindingPayload,
  verifyBindingSignature,
} from "@/lib/sharing/directory/signature";
import { fingerprint } from "@/lib/sharing/identity/keys";
import {
  appendKeyHistory,
  ensureSchema,
  getBindingByHash,
  upsertBinding,
} from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { parseRotateBody } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

// One generic failure for any rejected rotation, the caller cannot tell an
// unknown email from a bad signature.
const GENERIC_FAILURE = { error: "rotation failed" } as const;

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
  const parsed = parseRotateBody(body);
  if (!parsed) {
    return json(400, GENERIC_FAILURE);
  }

  const canonical = canonicalizeEmail(parsed.email);
  const emailHash = hashEmail(canonical, getPepper());

  await ensureSchema();

  // The identity must already exist, rotation replaces keys, it never creates a
  // binding (that is signup's job). No row means nothing to authorize against.
  const existing = await getBindingByHash(emailHash);
  if (!existing) {
    return json(400, GENERIC_FAILURE);
  }

  // Verify the signature over the NEW binding, against the STORED (current)
  // Ed25519 key. A valid signature proves the holder of the existing key
  // authorized these new keys. We deliberately verify against existing
  // .ed25519PublicKey, NOT against the new key in the body, so a stranger cannot
  // self-sign a replacement of someone else's identity.
  const payload = buildBindingPayload({
    email: canonical,
    x25519PublicKey: parsed.newX25519PublicKey,
    ed25519PublicKey: parsed.newEd25519PublicKey,
    issuedAt: parsed.issuedAt,
  });

  let sigOk = false;
  try {
    sigOk = verifyBindingSignature(
      payload,
      hexToBytes(parsed.signature),
      hexToBytes(existing.ed25519PublicKey),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return json(400, GENERIC_FAILURE);
  }

  // Derive the new fingerprint server-side from the verified new Ed25519 key
  // rather than trusting a client-sent value.
  const fp = fingerprint(hexToBytes(parsed.newEd25519PublicKey));

  // If the rotation omits a fresh backup blob, keep the one already stored rather
  // than wiping the user's recovery blob on a key-only rotation.
  const keyBackupBlob =
    parsed.keyBackupBlob !== null ? parsed.keyBackupBlob : existing.keyBackupBlob;

  await upsertBinding({
    emailHash,
    x25519PublicKey: parsed.newX25519PublicKey,
    ed25519PublicKey: parsed.newEd25519PublicKey,
    fingerprint: fp,
    keyBackupBlob,
  });
  await appendKeyHistory(
    emailHash,
    parsed.newX25519PublicKey,
    parsed.newEd25519PublicKey,
  );

  return json(200, { ok: true, fingerprint: fp });
}
