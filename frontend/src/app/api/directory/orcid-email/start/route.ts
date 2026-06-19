// ORCID-login email-capture, start route (section 18.7).
//
// POST { email }. The first half of the ORCID email-capture flow. ORCID OIDC
// returns no email, so a signed-in ORCID user with no email on file must supply
// one and prove they control it before it becomes the account identity. This
// route is the ORCID-gated equivalent of directory/signup: it requires a live
// ORCID session (the orcidId is the account-side identity), then emails a 6-digit
// OTP to the address the user typed. The response is uniform so it does not leak
// whether the address already maps to an existing account.
//
// Mandatory gate: NO ORCID session means a generic 401. The orcidId is never
// taken from the client, only from the server-side Auth.js session, so a caller
// cannot start a capture for an ORCID iD they do not control.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY, plus the AUTH_* vars used
// by the session.

import { randomBytes, bytesToHex } from "@noble/hashes/utils.js";

import { auth } from "@/lib/sharing/auth";
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

// The single uniform body every start attempt returns, so a caller cannot tell a
// fresh capture from a resend or an address that already exists.
const UNIFORM_OK = {
  ok: true,
  message: "If that email is valid, a verification code is on its way.",
} as const;

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // MANDATORY ORCID-session gate. Only a signed-in ORCID user can start an ORCID
  // email capture, and the orcidId comes from the session, never the body.
  let orcidId: string | null = null;
  try {
    const session = await auth();
    orcidId = session?.orcidId ?? null;
  } catch {
    orcidId = null;
  }
  if (!orcidId) {
    return json(401, { error: "unauthorized" });
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

  // Per-email-hash resend cap. We still return the uniform body on a limit hit so
  // the 429 cannot be used to confirm an address exists, but we stop sending.
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
