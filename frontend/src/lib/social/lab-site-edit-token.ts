// Lab-site "edit this site" short-lived signed token (token-handoff lane).
//
// WHY this exists: the public lab site at <slug>.research-os.com is fully
// cookie-isolated from the app at research-os.app (Auth.js uses SameSite=Lax,
// so a cross-origin session probe on .com always reads logged-out). The public
// page therefore cannot detect the signed-in owner on its own. Solution: when
// the signed-in PI or a granted editor clicks "View public site" inside the
// builder on .app, the .app link appends a SHORT-LIVED SIGNED TOKEN. The .com
// route validates it server-side and, when valid, promotes the minimal
// "Is this your lab? Manage this site" hint to the prominent "Edit this site"
// bridge bar.
//
// SECURITY FRAMING (read before changing this file):
//   - The token ONLY reveals the edit affordance on the public page. It is
//     NOT an access grant. The builder at /account/lab-site still re-checks
//     isSiteEditor / owner server-side before allowing any write. A leaked
//     or forged token at worst shows an "Edit this site" button to someone who
//     then cannot actually edit, because the builder's own authz blocks them.
//   - Still worth signing + slug-binding: prevents trivial forgery (an attacker
//     cannot mint their own token without AUTH_SECRET) and slug-scoping
//     (a token for smithlab.research-os.com cannot show the bar on jonelab).
//   - Short TTL (10 min): a shared link that inadvertently carries the token
//     expires before a random visitor can act on it.
//   - NEVER sets an app cookie on .com. The token lives only in the URL and
//     is consumed server-side. No session state crosses origins.
//
// Token format: base64url(payload_json) + "." + hmac_hex(base64url(payload_json))
//   payload: { slug: string, ownerKey: string, exp: number (Unix ms) }
//
// Signing key: AUTH_SECRET (the same secret the operator-token module uses).
// Minimum length 16 chars; absent / too short => mintEditToken returns null.
//
// Server-only: this module uses node:crypto. Do not import from client components.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { createHmac, timingSafeEqual } from "node:crypto";

/** 10-minute TTL. Short enough that a tab-shared link expires before misuse. */
const TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Signing helpers
// ---------------------------------------------------------------------------

/** Returns the AUTH_SECRET if it is long enough to be a real secret. */
function secret(): string | null {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** Base64url-encode a UTF-8 string (no padding). */
function b64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64url-decode back to a UTF-8 string. Returns null on malformed input. */
function b64urlDecode(s: string): string | null {
  // Re-pad so Buffer.from can parse it.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const missing = padded.length % 4;
  const padded2 = missing ? padded + "=".repeat(4 - missing) : padded;
  try {
    return Buffer.from(padded2, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** HMAC-SHA256 over the encoded payload. Returns null when no signing key. */
function hmacPayload(encodedPayload: string): string | null {
  const k = secret();
  if (!k) return null;
  return createHmac("sha256", k).update(encodedPayload).digest("hex");
}

/** Constant-time hex-string compare that also handles length mismatch. */
function hmacEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface EditTokenPayload {
  slug: string;
  ownerKey: string;
  exp: number;
}

/**
 * Mint a short-lived signed token that proves the caller is an owner / granted
 * editor of the given lab slug. Returns null when AUTH_SECRET is absent or too
 * short (feature disabled, fall back to the static "Manage this site" hint).
 *
 * @param slug      The normalised lab slug (same as stored in slug_registry).
 * @param ownerKey  The billing owner key for the site (peppered email hash).
 * @returns         A signed token string, or null when the secret is missing.
 */
export function mintEditToken(slug: string, ownerKey: string): string | null {
  if (!slug || !ownerKey) return null;
  const payload: EditTokenPayload = {
    slug,
    ownerKey,
    exp: Date.now() + TTL_MS,
  };
  const encoded = b64url(JSON.stringify(payload));
  const sig = hmacPayload(encoded);
  if (!sig) return null;
  return `${encoded}.${sig}`;
}

/**
 * Verify a token from the ?roEdit= URL param. Checks signature, expiry, and
 * slug binding. Returns the ownerKey embedded in the token when all checks pass,
 * or null when anything fails (invalid format, bad sig, expired, wrong slug).
 *
 * Call this SERVER-SIDE only (node:crypto, not available in Edge).
 *
 * @param token  The raw string from the URL param (may be undefined / null / garbage).
 * @param slug   The lab slug for this page. Used to verify slug binding.
 * @returns      The ownerKey when valid, null otherwise.
 */
export function verifyEditToken(
  token: string | null | undefined,
  slug: string,
): string | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Signature check first (before parsing payload, to avoid parsing garbage).
  const expected = hmacPayload(encoded);
  if (!expected) return null; // No signing key configured.
  if (!hmacEqual(sig, expected)) return null;

  // Parse payload.
  const raw = b64urlDecode(encoded);
  if (!raw) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).slug !== "string" ||
    typeof (payload as Record<string, unknown>).ownerKey !== "string" ||
    typeof (payload as Record<string, unknown>).exp !== "number"
  ) {
    return null;
  }
  const p = payload as EditTokenPayload;

  // Expiry check.
  if (p.exp < Date.now()) return null;

  // Slug binding: the token is only valid for the slug it was minted for.
  if (p.slug !== slug) return null;

  return p.ownerKey;
}
