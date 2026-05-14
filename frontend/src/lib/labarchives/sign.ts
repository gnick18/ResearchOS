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
 * Pure utility, no I/O except for `syncEpochOffset` which probes the
 * unsigned `/utilities/epoch_time` endpoint. Both the signing route and the
 * server-side API client use these helpers.
 */
import { createHmac } from "node:crypto";

/**
 * Clock-skew offset (server_ms − local_ms) cached at module scope. Initially
 * `null`, meaning "haven't synced yet — fall back to local clock." Refreshed
 * by `syncEpochOffset(baseUrl)`, which the route handlers call on first use
 * and again after any 401 from a signed request (in case the deployment
 * server's clock has drifted past LabArchives' accept window).
 *
 * Why a module-scope offset and not a per-request sync? The Python reference
 * client (`mcmero/labarchives-py`, client.py:24-55) syncs once at
 * construction and reuses the offset for the process lifetime. We mirror
 * that — re-syncing on every signed call would double the round-trips for
 * what's normally an in-spec local clock.
 */
let epochOffsetMs: number | null = null;

/**
 * Probe `${baseUrl}/utilities/epoch_time` to compute a clock-skew offset.
 * This endpoint is unsigned (per the reference clients) so we can call it
 * before we know the offset.
 *
 * On success: caches `server_ms - local_ms` in `epochOffsetMs` and returns
 * it. On any failure (network error, non-2xx, unparseable body): leaves the
 * cached offset unchanged and returns `null`. Callers should treat `null`
 * as "we couldn't sync, keep using whatever offset we had (or no offset)."
 *
 * LabArchives' epoch_time endpoint returns plain text containing the server
 * epoch in milliseconds, sometimes wrapped in trivial XML. We accept either
 * shape and pull the first sequence of 10+ digits.
 */
export async function syncEpochOffset(baseUrl: string): Promise<number | null> {
  const url = `${baseUrl.replace(/\/+$/, "")}/utilities/epoch_time`;
  try {
    const localBefore = Date.now();
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    // The endpoint returns the raw epoch_ms as text (sometimes wrapped in
    // a tiny XML element). Grab the first ≥10-digit run we see.
    const m = text.match(/(\d{10,})/);
    if (!m) return null;
    const serverMs = Number(m[1]);
    if (!Number.isFinite(serverMs)) return null;
    // Approximate the local clock at "when the server answered" using the
    // midpoint of the round-trip. Close enough — LabArchives' accept window
    // is multi-minute, we just need to be within that.
    const localAfter = Date.now();
    const localMid = (localBefore + localAfter) / 2;
    epochOffsetMs = Math.round(serverMs - localMid);
    return epochOffsetMs;
  } catch {
    return null;
  }
}

/** Reset the cached offset. Test-only — production code should rely on
 *  `syncEpochOffset` to refresh after a 401. */
export function _resetEpochOffsetForTests(): void {
  epochOffsetMs = null;
}

/** LabArchives produces server-side epoch time in milliseconds. We use the
 *  local clock adjusted by the cached offset (if `syncEpochOffset` has run);
 *  otherwise we fall back to the raw local clock and accept that LabArchives'
 *  multi-minute window will absorb small skews. */
export function nowMs(): number {
  return Date.now() + (epochOffsetMs ?? 0);
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
