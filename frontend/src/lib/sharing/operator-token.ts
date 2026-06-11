// Operator access-code crypto (server-only).
//
// A convenience fallback to the OAuth operator sign-in: the operator types a
// long secret code (stored ONLY as the OPERATOR_ACCESS_CODE env var, never in the
// repo or the browser), the server compares it constant-time, and on a match
// mints a signed, time-limited token stored in an httpOnly cookie. The token is
// an HMAC over its own expiry using AUTH_SECRET, so it cannot be forged and
// cannot be read by client JavaScript.
//
// This is deliberately a SINGLE shared secret, so it is weaker than OAuth (no
// MFA, anyone holding the code gets in). Keep OPERATOR_ACCESS_CODE long and
// private; OAuth stays the primary path. Fails closed everywhere: no code
// configured, no AUTH_SECRET, or any parse error means access is denied.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { createHmac, timingSafeEqual } from "node:crypto";

export const OPERATOR_COOKIE = "ros_op";
/** 30 days, matching the chosen session length. */
export const OPERATOR_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

/** The signing key. Null (feature disabled) unless AUTH_SECRET is a real secret. */
function signingSecret(): string | null {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** Length-safe constant-time string compare. */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** Whether an operator access code is configured (long enough to be a real
 *  secret). When false the whole code path is off and only OAuth works. */
export function operatorCodeConfigured(): boolean {
  const c = process.env.OPERATOR_ACCESS_CODE;
  return !!c && c.length >= 12 && signingSecret() !== null;
}

/** Constant-time check of a submitted code against OPERATOR_ACCESS_CODE. */
export function verifyOperatorCode(code: unknown): boolean {
  const expected = process.env.OPERATOR_ACCESS_CODE;
  if (!expected || expected.length < 12) return false;
  if (typeof code !== "string" || code.length === 0) return false;
  return constantTimeEquals(code, expected);
}

function hmac(payload: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Mint a token valid until `expiryMs`. Format `${expiryMs}.${hmacHex}`. Returns
 *  null when there is no signing secret. */
export function signOperatorToken(expiryMs: number): string | null {
  const sig = hmac(`operator:${expiryMs}`);
  return sig ? `${expiryMs}.${sig}` : null;
}

/** True only for a token with a valid signature that has not expired. */
export function verifyOperatorToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiryMs = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;
  const expected = hmac(`operator:${expiryMs}`);
  if (!expected) return false;
  return constantTimeEquals(sig, expected);
}
