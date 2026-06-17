// Cross-boundary sharing, OAuth key-bind route.
//
// POST { x25519PublicKey, ed25519PublicKey, keyBackupBlob, signature, issuedAt }.
// This is the OAuth equivalent of directory/verify. Instead of confirming a
// 6-digit OTP, it reads the email from the Auth.js session (proven by a Google
// or GitHub sign-in), then verifies the user's Ed25519 signature over the
// email-to-keys binding before storing it, so the directory only ever holds keys
// vouched for by whoever controls the signing key (section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md). The request carries NO
// email and NO otp, the verified email never comes from the client. Every
// failure returns one generic error so nothing about which step failed leaks.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, plus the AUTH_* vars used by the session.

import { hexToBytes } from "@noble/hashes/utils.js";

import { auth } from "@/lib/sharing/auth";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import {
  buildBindingPayload,
  verifyBindingSignature,
} from "@/lib/sharing/directory/signature";
import { fingerprint } from "@/lib/sharing/identity/keys";
import {
  appendKeyHistory,
  ensureProfileSchema,
  ensureSchema,
  upsertBinding,
  upsertProfile,
} from "@/lib/sharing/directory/db";
import { extractVerifiedDomain } from "@/lib/sharing/directory/affiliationDomain";
import { seedStarterGrant } from "@/lib/billing/seed-grant";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { parseOAuthBindBody } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

// One generic failure for any rejected bind, the caller cannot tell a malformed
// body from a bad signature.
const GENERIC_FAILURE = { error: "binding failed" } as const;

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // No session, or a session without a verified email, means the caller has not
  // proven they own any address. Generic 401, never say which.
  const session = await auth();
  const sessionEmail = session?.user?.email;
  if (!sessionEmail) {
    return json(401, { error: "unauthorized" });
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
  const parsed = parseOAuthBindBody(body);
  if (!parsed) {
    return json(400, GENERIC_FAILURE);
  }

  // The email is the OAuth-verified one from the session, never from the body.
  const canonical = canonicalizeEmail(sessionEmail);
  const emailHash = hashEmail(canonical, getPepper());

  // Verify the binding signature over the canonical payload, using the Ed25519
  // public key the client claims. The signed bytes cover the canonical plaintext
  // email (which the client knows from its own login), not the peppered hash. A
  // bad signature means we do not store the binding.
  const payload = buildBindingPayload({
    email: canonical,
    x25519PublicKey: parsed.x25519PublicKey,
    ed25519PublicKey: parsed.ed25519PublicKey,
    issuedAt: parsed.issuedAt,
  });

  let sigOk = false;
  try {
    sigOk = verifyBindingSignature(
      payload,
      hexToBytes(parsed.signature),
      hexToBytes(parsed.ed25519PublicKey),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return json(400, GENERIC_FAILURE);
  }

  // Derive the comparable fingerprint server-side from the verified Ed25519 key
  // rather than trusting a client-sent value.
  const fp = fingerprint(hexToBytes(parsed.ed25519PublicKey));

  await ensureSchema();
  await upsertBinding({
    emailHash,
    x25519PublicKey: parsed.x25519PublicKey,
    ed25519PublicKey: parsed.ed25519PublicKey,
    fingerprint: fp,
    keyBackupBlob: parsed.keyBackupBlob,
  });
  await appendKeyHistory(
    emailHash,
    parsed.x25519PublicKey,
    parsed.ed25519PublicKey,
  );

  // Eagerly mint the one-time sign-up gift now that the account exists, so the
  // token balance is real and visible in Settings and the BeakerBot chat header
  // before the user's first AI turn. The emailHash IS the billing owner key (the
  // same peppered hash ownerKeyForEmail produces), the grant is idempotent, and
  // the seed is best-effort so it never aborts the bind.
  await seedStarterGrant(emailHash);

  // Create the researcher profile at signup so an account IS a profile (no
  // separate publish step). The display name is optional, present only when the
  // wizard collected one (it prefills from the OAuth session name). The
  // affiliation_domain badge is derived server-side from the OAuth-verified
  // email. Best-effort, a profile write never aborts the bind.
  if (parsed.displayName) {
    try {
      await ensureProfileSchema();
      await upsertProfile({
        fingerprint: fp,
        displayName: parsed.displayName,
        affiliation: null,
        affiliationDomain: extractVerifiedDomain(canonical),
        orcid: null,
        pinnedWorks: [],
        hiddenWorks: [],
        notifyOnCollabInvite: true,
      });
    } catch {
      // Profile is best-effort; the user can finish it later in Settings.
    }
  }

  return json(200, { ok: true, fingerprint: fp });
}
