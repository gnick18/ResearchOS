// Cross-boundary sharing, INVITE accept-page key parsing (P1-A).
//
// Pure, browser-agnostic helpers for recovering the one-time key on the accept
// page, split out of the page component so they can be unit tested without a DOM.
// The key reaches the recipient OUT OF BAND now (the email is keyless), so the
// page recovers it from one of two equivalent places, the URL FRAGMENT of a
// sender-delivered private link, or a code the recipient pastes. Both yield the
// SAME 64-hex secret, and in both cases it stays client-side, it is only ever
// used locally to decrypt and is NEVER sent to a server.

/** A valid one-time key is exactly 64 lowercase hex chars (32 bytes). */
export const KEY_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Reads the one-time key from a URL fragment string (e.g. window.location.hash),
 * shaped "#k=<hex>" (optionally with other &-joined fragment params). Returns the
 * lowercased 64-hex key, or null if absent / malformed. Case-insensitive on input
 * so a hand-copied link still opens.
 */
export function readFragmentKey(hash: string): string | null {
  const m = /(?:^#|&)k=([0-9a-fA-F]+)/.exec(hash);
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return KEY_HEX_RE.test(hex) ? hex : null;
}

/**
 * Parses what the recipient pastes into the "unlock code" field. Accepts either
 * the bare 64-hex code OR a full private link / fragment the sender sent (so a
 * recipient who pastes the whole "...#k=<hex>" link still works). Returns the
 * lowercased 64-hex key, or null if it is not a recoverable code. Like the
 * fragment, the result never leaves the browser, it is only used to decrypt.
 */
export function parseUnlockCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // A bare code is the common case, accept it case-insensitively.
  const bare = trimmed.toLowerCase();
  if (KEY_HEX_RE.test(bare)) return bare;
  // Otherwise the recipient may have pasted the whole private link or its
  // fragment, recover the key the same way the fragment reader does. Normalize a
  // leading "k=..." (no #) into a fragment shape the reader understands.
  const hashIndex = trimmed.indexOf("#");
  const fragment =
    hashIndex >= 0 ? trimmed.slice(hashIndex) : `#${trimmed}`;
  return readFragmentKey(fragment);
}
