// The canonical app origin for building user-shareable links (lab invites,
// accept links, etc).
//
// Links minted from window.location.origin point back at WHATEVER deployment
// minted them, so a link created on a Vercel preview URL or a localhost dev
// server sends the recipient there instead of the real site. For a link a user
// will hand to someone else, prefer a fixed canonical base URL when one is
// configured (NEXT_PUBLIC_APP_BASE_URL, e.g. https://research-os.app set in
// Vercel), and fall back to the live origin in dev / when unset so local and
// preview flows keep working.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * The origin to embed in a shareable link. Returns the configured canonical base
 * URL (trailing slash trimmed) when set, otherwise the current window origin,
 * otherwise an empty string (SSR with nothing configured).
 */
export function canonicalAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
