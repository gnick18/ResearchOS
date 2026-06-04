// Cross-boundary sharing, directory key-backup recovery route (Phase 1b-iii).
//
// POST { email, otp }. Returns the user's encrypted key-backup blob to whoever
// proves ownership of the email via the OTP code. The flow, the client first
// calls POST /api/directory/signup { email } to receive a 6-digit code, then
// calls this route with that code. The blob is end-to-end encrypted by the
// client's recovery passphrase, the operator cannot read it, so returning it on
// email-ownership proof is safe. This is the path a user takes after losing the
// device that held their private keys (section 6 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md).
//
// The OTP handling mirrors the verify route, read the pending code, enforce the
// attempt cap and TTL, verify, burn on success. Every failure returns one
// generic error so a caller cannot tell a bad code from an expired one.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL,
// KV_REST_API_URL, KV_REST_API_TOKEN.

import { hexToBytes } from "@noble/hashes/utils.js";

import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { verifyOtp } from "@/lib/sharing/directory/otp";
import {
  ensureSchema,
  getBackupBlob,
} from "@/lib/sharing/directory/db";
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
import { parseEmailBody } from "@/lib/sharing/directory/validation";

export const runtime = "nodejs";

// One generic failure for any rejected recovery, the caller cannot tell a bad
// OTP from an expired code.
const GENERIC_FAILURE = { error: "recovery failed" } as const;

// A 6-digit numeric OTP, the shape generateOtp produces (matches validation.ts).
const OTP_RE = /^\d{6}$/;

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

  // Reuse the shared email validation, then check the OTP shape the same way the
  // verify body parser does.
  const parsedEmail = parseEmailBody(body);
  const otp =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).otp
      : undefined;
  if (!parsedEmail || typeof otp !== "string" || !OTP_RE.test(otp)) {
    return json(400, GENERIC_FAILURE);
  }

  const canonical = canonicalizeEmail(parsedEmail.email);
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
  const otpOk = verifyOtp(otp, salt, stored.hashedOtp);
  if (!otpOk) {
    const attempts = await incrementOtpAttempts(emailHash, stored);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await consumeOtp(emailHash);
    }
    return json(400, GENERIC_FAILURE);
  }

  // OTP is good, single-use, burn it now whether or not a blob exists so a
  // verified code cannot be replayed.
  await consumeOtp(emailHash);

  // Fetch the stored blob. A uniform { found } shape covers both "no binding"
  // and "binding without a stored blob", the caller learns only whether there is
  // a blob to recover, never anything about which case applied.
  const keyBackupBlob = await getBackupBlob(emailHash);
  if (!keyBackupBlob) {
    return json(200, { found: false });
  }

  return json(200, { found: true, keyBackupBlob });
}
