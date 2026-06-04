// Cross-boundary sharing, directory signup route (Phase 1b-ii).
//
// POST { email }. Starts email-ownership proof by emailing a 6-digit OTP. The
// response is uniform whether or not the email is already registered, so the
// directory cannot be probed for who-has-an-account (section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md). Rate limited per IP and
// per email hash. Env is read lazily inside the handler.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY.

import { randomBytes, bytesToHex } from "@noble/hashes/utils.js";

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { generateOtp, hashOtp } from "@/lib/sharing/directory/otp";
import { ensureSchema } from "@/lib/sharing/directory/db";
import {
  getIpLimiter,
  getSignupLimiter,
  storeOtp,
} from "@/lib/sharing/directory/ratelimit";
import { sendOtpEmail } from "@/lib/sharing/directory/mailer";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { parseEmailBody } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

// The single uniform body every signup attempt returns, so a caller cannot tell
// a fresh signup from a resend to an existing identity.
const UNIFORM_OK = {
  ok: true,
  message: "If that email is valid, a verification code is on its way.",
};

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // Per-IP cap first, before any work, to blunt a flood from one source.
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
  const parsed = parseEmailBody(body);
  if (!parsed) {
    return json(400, { error: "invalid request" });
  }

  const canonical = canonicalizeEmail(parsed.email);
  const emailHash = hashEmail(canonical, getPepper());

  // Per-email-hash cap (the resend limit). We still return the uniform body on a
  // limit hit so an attacker cannot use the 429 to confirm an address exists,
  // but we do stop sending the email.
  const signupVerdict = await getSignupLimiter().limit(emailHash);
  if (!signupVerdict.success) {
    return json(200, UNIFORM_OK);
  }

  await ensureSchema();

  const otp = generateOtp();
  const salt = randomBytes(16);
  const saltHex = bytesToHex(salt);
  const hashedOtp = hashOtp(otp, salt);
  await storeOtp(emailHash, hashedOtp, saltHex);

  try {
    await sendOtpEmail(canonical, otp);
  } catch {
    // Do not leak a send failure as a distinguishable response. The code is
    // stored, the user can resend. A 500 here would also reveal the address was
    // accepted, so we keep the uniform body.
  }

  return json(200, UNIFORM_OK);
}
