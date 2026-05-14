/**
 * LabArchives REST API signing helpers.
 *
 * Unlike Google / Microsoft, LabArchives does NOT use OAuth2. Every API call
 * carries an HMAC-SHA1 signature over `{akid}{apiMethod}{expires}` keyed by
 * the institution's "access password" — see
 * https://api.labarchives.com/api (regional base URL also possible: e.g.
 * https://auapi.labarchives.com/api for Australia,
 * https://aueuapi.labarchives.com/api for Europe).
 *
 * Pure utility, no I/O. Both the signing route and the server-side API
 * client use these helpers.
 */
import { createHmac } from "node:crypto";

/** LabArchives produces server-side epoch time in milliseconds. We use the
 *  local clock by default — small skew is fine because LabArchives accepts a
 *  multi-minute window. The Python reference client also uses local time. */
export function nowMs(): number {
  return Date.now();
}

/** Build the base64-encoded HMAC-SHA1 signature LabArchives expects.
 *  The signed string is `{akid}{apiMethod}{expires}`. The secret is the
 *  institution's access password. Returns un-URL-encoded base64 — callers
 *  pass it to URLSearchParams which handles the percent-encoding. */
export function signRequest(
  accessKeyId: string,
  accessPassword: string,
  apiMethod: string,
  expiresMs: number,
): string {
  const stringToSign = `${accessKeyId}${apiMethod}${expiresMs}`;
  const hmac = createHmac("sha1", accessPassword);
  hmac.update(stringToSign, "utf8");
  return hmac.digest("base64");
}

export interface SignedParams {
  akid: string;
  expires: string;
  sig: string;
}

/** Convenience wrapper: returns the three query params every signed request
 *  carries (`akid`, `expires`, `sig`). */
export function buildSignedParams(
  accessKeyId: string,
  accessPassword: string,
  apiMethod: string,
  expiresMs: number = nowMs(),
): SignedParams {
  return {
    akid: accessKeyId,
    expires: String(expiresMs),
    sig: signRequest(accessKeyId, accessPassword, apiMethod, expiresMs),
  };
}
