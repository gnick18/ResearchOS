// Loro Phase 3, chunk 4: manual join link for the two-tab MVP.
//
// PURPOSE. For the MVP test (same identity in both tabs, no X25519 wrapping),
// the session initiator needs a way to hand the sessionId + sessionKey to the
// joiner. We encode them as a compact base64url string that can be copied and
// pasted. No server round-trip, no directory lookup.
//
// WIRE FORMAT. The encoded link is the base64url encoding of a UTF-8 JSON
// object: { v: 1, sid: string, key: string } where `key` is the base64url
// encoding of the raw 32-byte session key. v=1 lets us detect and reject stale
// format if the schema ever changes.
//
// SECURITY NOTE. This MVP link carries the raw session key in the clear.
// Anyone who obtains the link string can join the session and read/write its
// frames (once they also have a matching identity to pass frame verification).
// For the two-tab same-identity test this is intentional. A later chunk will
// wrap the key with X25519 so only the designated recipient can unwrap it.
//
// Pure functions, no React, no network, no storage.

// ---------------------------------------------------------------------------
// Helpers: base64url encode / decode without padding.
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  // btoa works on binary strings.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  // Restore standard base64 padding.
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(pad);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Wire payload shape.
// ---------------------------------------------------------------------------

interface LinkPayload {
  v: number;
  sid: string;
  key: string; // base64url-encoded 32-byte session key
}

// ---------------------------------------------------------------------------
// encodeSessionLink
// ---------------------------------------------------------------------------

/**
 * Encodes a sessionId + sessionKey into a compact base64url string suitable
 * for copy-paste. The other tab passes this string to decodeSessionLink and
 * joins the same session.
 */
export function encodeSessionLink(p: {
  sessionId: string;
  sessionKey: Uint8Array;
}): string {
  const payload: LinkPayload = {
    v: 1,
    sid: p.sessionId,
    key: toBase64Url(p.sessionKey),
  };
  const json = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(json);
  return toBase64Url(jsonBytes);
}

// ---------------------------------------------------------------------------
// decodeSessionLink
// ---------------------------------------------------------------------------

/**
 * Decodes a session link produced by encodeSessionLink. Trims surrounding
 * whitespace before decoding so pasted links with a trailing newline or
 * leading space are handled cleanly. Returns null on any parse error, version
 * mismatch, missing field, or malformed key bytes so callers never crash.
 */
export function decodeSessionLink(
  link: string,
): { sessionId: string; sessionKey: Uint8Array } | null {
  try {
    const trimmed = link.trim();
    if (!trimmed) return null;

    const jsonBytes = fromBase64Url(trimmed);
    const json = new TextDecoder().decode(jsonBytes);
    const payload = JSON.parse(json) as unknown;

    // Type-guard: must be an object with v=1, sid string, key string.
    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as LinkPayload).v !== 1 ||
      typeof (payload as LinkPayload).sid !== "string" ||
      typeof (payload as LinkPayload).key !== "string"
    ) {
      return null;
    }

    const { sid, key } = payload as LinkPayload;
    if (!sid) return null;

    const sessionKey = fromBase64Url(key);
    if (sessionKey.length !== 32) return null;

    return { sessionId: sid, sessionKey };
  } catch {
    // Any JSON.parse failure, atob error, or TextDecoder error -> null.
    return null;
  }
}
