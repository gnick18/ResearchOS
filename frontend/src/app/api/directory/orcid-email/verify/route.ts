// ORCID-login email-capture, verify route (section 18.7).
//
// POST { email, otp }. The second half of the ORCID email-capture flow. Confirms
// the 6-digit OTP the start route emailed, then binds the now-verified email to
// the signed-in ORCID iD (directory_orcid_links: email_hash + email_enc) so every
// future ORCID login resolves this account transparently. The OTP step is
// MANDATORY before any binding is written, so a user cannot claim an email they
// do not control and hijack another person's account.
//
// Account linking by proven ownership: if the verified email already maps to an
// existing account (any provider), binding the ORCID iD to it is the CORRECT
// outcome, not a duplicate. storeOrcidEmail keys directory_orcid_links by
// orcid_id and writes the SAME peppered email_hash any other provider would
// produce, so the ORCID iD simply becomes a second sign-in path to the same
// account. No separate merge step is needed.
//
// Every failure returns ONE generic error so nothing about which step failed
// (bad OTP, expired code, no session) leaks.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, ORCID_EMAIL_ENC_KEY,
// DATABASE_URL, KV_REST_API_URL, KV_REST_API_TOKEN, plus the AUTH_* vars used by
// the session.

import { hexToBytes } from "@noble/hashes/utils.js";

import { auth } from "@/lib/sharing/auth";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { verifyOtp } from "@/lib/sharing/directory/otp";
import {
  ensureOrcidSchema,
  ensureSchema,
  storeOrcidEmail,
} from "@/lib/sharing/directory/db";
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
import { parseOrcidEmailVerifyBody } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

// One generic failure for any rejected verify, the caller cannot tell a bad OTP
// from an expired code from a missing session.
const GENERIC_FAILURE = { error: "verification failed" } as const;

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // MANDATORY ORCID-session gate. The orcidId the email is bound TO comes from
  // the server-side session, never the client, so a caller cannot bind an email
  // to an ORCID iD they do not control. A missing session is the same generic
  // failure as a bad code (do not leak which step failed).
  let orcidId: string | null = null;
  try {
    const session = await auth();
    orcidId = session?.orcidId ?? null;
  } catch {
    orcidId = null;
  }
  if (!orcidId) {
    return json(400, GENERIC_FAILURE);
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
  const parsed = parseOrcidEmailVerifyBody(body);
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
  // cannot be retried.
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

  // OTP is good, the user controls this email. Bind it to the ORCID iD. This
  // writes the peppered email_hash (the directory/billing key) AND email_enc (the
  // recoverable, encrypted-at-rest copy) so a future ORCID login resolves the
  // account. If the email already maps to an existing account, this links the
  // ORCID iD to it by proven ownership (the correct outcome, not a duplicate).
  await ensureOrcidSchema();
  await storeOrcidEmail(orcidId, canonical, emailHash);

  // Mint the one-time sign-up gift now that the account identity is real, keyed
  // by the SAME peppered email_hash ownerKeyForEmail produces. Idempotent, so an
  // ORCID iD linking to an existing account does not double-grant, and
  // best-effort, so a grant failure never aborts the bind.
  try {
    await seedStarterGrant(emailHash);
  } catch {
    // Grant is best-effort; the binding is what matters here.
  }

  // Single-use code, burn it on success.
  await consumeOtp(emailHash);

  return json(200, { ok: true });
}
