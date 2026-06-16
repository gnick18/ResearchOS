// Social / researcher-network layer flag (Phase A).
//
// Gates the public researcher-network surfaces (the /network hub, the public
// search, the richer /u/[handle] profile, and the discoverability sweep that
// links to them) behind a single env flag, default OFF. With the flag off the
// app is byte-for-byte unchanged: /network 404s, the nav/footer/search entries
// are absent, and /u renders its existing thin card.
//
// Mirrors the ASSET_LIBRARY_ENABLED pattern in lib/figure/asset-library.ts. As a
// NEXT_PUBLIC_ var it is inlined at build time, so it must be set before the
// build to flip on in production.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const SOCIAL_LAYER_ENABLED =
  process.env.NEXT_PUBLIC_SOCIAL_LAYER === "1" ||
  process.env.NEXT_PUBLIC_SOCIAL_LAYER === "true";
