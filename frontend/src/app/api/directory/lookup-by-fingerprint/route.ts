// Social layer (Phase C2), recipient PUBLIC-KEY lookup by fingerprint.
//
// GET /api/directory/lookup-by-fingerprint?fp=<compact-fingerprint>
//
// Returns the PUBLIC keys (x25519 + ed25519) + fingerprint for a LISTED,
// published researcher, so the no-email fingerprint-routed send can seal a bundle
// to a researcher found on the /network hub. Public keys are not secret, and this
// is an EXACT-match lookup (the caller must already hold the full fingerprint, the
// same non-enumerable shape as /researcher and /lookup), so it cannot be used to
// browse or harvest the directory.
//
// It NEVER returns the email, the email hash, or the key-backup blob, only the
// public key material needed to seal. The mailbox is addressed server-side by the
// relay /send route (which resolves the fingerprint to the recipient hash), so the
// sender never learns the recipient's email.
//
// PUBLIC (no session), like /researcher. Gated on isSharingEnabled() and IP rate
// limited. getBindingByFingerprint only resolves profiles with unlisted = false,
// so an opted-out researcher is invisible here too.
//
// Reads env: SHARING_ENABLED, KV_REST_API_URL, KV_REST_API_TOKEN, DATABASE_URL.

import {
  ensureProfileSchema,
  ensureSchema,
  getBindingByFingerprint,
} from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const ip = extractClientIp(request.headers);
  const verdict = await getIpLimiter().limit(ip);
  if (!verdict.success) {
    return json(429, { error: "rate limited" });
  }

  const compact = (new URL(request.url).searchParams.get("fp") ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(compact)) {
    return json(400, { error: "not found" });
  }

  await ensureSchema();
  await ensureProfileSchema();

  let binding;
  try {
    binding = await getBindingByFingerprint(compact);
  } catch {
    return json(500, { error: "lookup failed" });
  }

  if (!binding) {
    return json(200, { found: false });
  }

  // Public key material only. NEVER the email hash or the key-backup blob.
  return json(200, {
    found: true,
    x25519PublicKey: binding.x25519PublicKey,
    ed25519PublicKey: binding.ed25519PublicKey,
    fingerprint: binding.fingerprint,
  });
}
