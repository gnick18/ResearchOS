// Cross-boundary sharing, directory verify route (Phase 1b-ii).
//
// POST { email, otp, x25519PublicKey, ed25519PublicKey, keyBackupBlob,
// signature, issuedAt }. Confirms the OTP, then verifies the user's Ed25519
// signature over the email-hash-to-keys binding before storing it, so the
// directory only ever holds keys submitted by whoever controls the signing key
// (section 6 of docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md). Every
// failure returns one generic error so nothing about which step failed leaks.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN.

import { hexToBytes } from "@noble/hashes/utils.js";

import { auth } from "@/lib/sharing/auth";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { verifyOtp } from "@/lib/sharing/directory/otp";
import {
  buildBindingPayload,
  verifyBindingSignature,
} from "@/lib/sharing/directory/signature";
import { fingerprint } from "@/lib/sharing/identity/keys";
import {
  appendKeyHistory,
  ensureOrcidSchema,
  ensureProfileSchema,
  ensureSchema,
  linkOrcid,
  upsertBinding,
  upsertProfile,
} from "@/lib/sharing/directory/db";
import { extractVerifiedDomain } from "@/lib/sharing/directory/affiliationDomain";
import { seedStarterGrant } from "@/lib/billing/seed-grant";
import {
  consumeOtp,
  getIpLimiter,
  incrementOtpAttempts,
  MAX_OTP_ATTEMPTS,
  readOtp,
} from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { parseVerifyBody } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

// One generic failure for any rejected verify, the caller cannot tell a bad OTP
// from a bad signature from an expired code.
const GENERIC_FAILURE = { error: "verification failed" } as const;

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
  const parsed = parseVerifyBody(body);
  if (!parsed) {
    return json(400, GENERIC_FAILURE);
  }

  const canonical = canonicalizeEmail(parsed.email);
  const emailHash = hashEmail(canonical, getPepper());

  await ensureSchema();

  // Read the pending OTP. Absent means never issued or already expired (TTL).
  const stored = await readOtp(emailHash);
  if (!stored) {
    return json(400, GENERIC_FAILURE);
  }

  // Enforce the attempt cap before checking, so a code that already hit the cap
  // cannot be retried. (Belt and suspenders, the cap is also enforced on the
  // failing branch below.)
  if (stored.attempts >= MAX_OTP_ATTEMPTS) {
    await consumeOtp(emailHash);
    return json(400, GENERIC_FAILURE);
  }

  const salt = hexToBytes(stored.saltHex);
  const otpOk = verifyOtp(parsed.otp, salt, stored.hashedOtp);
  if (!otpOk) {
    const attempts = await incrementOtpAttempts(emailHash, stored);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await consumeOtp(emailHash);
    }
    return json(400, GENERIC_FAILURE);
  }

  // OTP is good. Now verify the binding signature over the canonical payload,
  // using the Ed25519 public key the client claims. The signed bytes cover the
  // canonical plaintext email (which the client has), not the peppered hash
  // (which it does not). A bad signature means we do not store the binding (the
  // keys were not vouched for by the signing key).
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
    // A valid OTP but a bad signature is a malformed or hostile request, burn
    // the code so it cannot be paired with a forged signature on a retry.
    await consumeOtp(emailHash);
    return json(400, GENERIC_FAILURE);
  }

  // Derive the comparable fingerprint server-side from the verified Ed25519 key
  // rather than trusting a client-sent value.
  const fp = fingerprint(hexToBytes(parsed.ed25519PublicKey));

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

  // Best-effort ORCID link. If the user reached this route after signing in
  // with ORCID (which carries no email), the still-active Auth.js session holds
  // an orcidId. Record the orcid_id -> email_hash link so future ORCID sign-ins
  // can resolve to this account. Failures never abort the bind. One session read,
  // reused for the profile's ORCID below.
  let sessionOrcidId: string | null = null;
  try {
    const session = await auth();
    sessionOrcidId = session?.orcidId ?? null;
    if (sessionOrcidId) {
      await ensureOrcidSchema();
      await linkOrcid(sessionOrcidId, emailHash);
    }
  } catch {
    // Link is best-effort; do not fail the bind if the ORCID step errors.
  }

  // Create the researcher profile at signup so an account IS a profile (no
  // separate publish step). The display name is optional, present only when the
  // wizard collected one. affiliation_domain is derived server-side from the
  // verified email. Best-effort, a profile write never aborts the bind.
  if (parsed.displayName) {
    try {
      await ensureProfileSchema();
      await upsertProfile({
        fingerprint: fp,
        displayName: parsed.displayName,
        affiliation: null,
        affiliationDomain: extractVerifiedDomain(canonical),
        orcid: sessionOrcidId,
        pinnedWorks: [],
        hiddenWorks: [],
        notifyOnCollabInvite: true,
      });
    } catch {
      // Profile is best-effort; the user can finish it later in Settings.
    }
  }

  // Single-use code, burn it on success.
  await consumeOtp(emailHash);

  return json(200, { ok: true, fingerprint: fp });
}
