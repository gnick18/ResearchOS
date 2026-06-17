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

// Lab companion-sites (lab-domains Phase 1) flag.
//
// Gates the lab-slug / companion-site surfaces (Phase 1 = the slug-availability
// API stub; later phases = the lab_sites pages and rendering). Kept SEPARATE
// from SOCIAL_LAYER_ENABLED on purpose: companion sites are a paid-lab feature
// that can ship independently of the public researcher network.
//
// Two flags, mirroring the directory split (guard.isSocialLayerEnabled is the
// SERVER gate, NEXT_PUBLIC_SOCIAL_LAYER is the CLIENT gate):
//   - LAB_SITES_ENABLED        SERVER gate, read lazily in route handlers, so an
//                              API route 404s until it is deliberately flipped.
//   - NEXT_PUBLIC_LAB_SITES    CLIENT gate, inlined at build time, hides any
//                              user-facing UI. Default OFF => byte-identical app.
//
// Read the server flag through isLabSitesEnabled() so it is evaluated at request
// time (it must NOT be inlined; route handlers read process.env lazily). The
// client constant below is the build-time-inlined NEXT_PUBLIC value.

/** SERVER gate for lab companion-site routes. Read lazily at request time. */
export function isLabSitesEnabled(): boolean {
  return process.env.LAB_SITES_ENABLED === "true";
}

/** CLIENT gate for lab companion-site UI. Inlined at build time, default OFF. */
export const LAB_SITES_ENABLED =
  process.env.NEXT_PUBLIC_LAB_SITES === "1" ||
  process.env.NEXT_PUBLIC_LAB_SITES === "true";

// BYO ("bring your own") static-site hosting SUB-FLAG (lab-domains BYO Slice 1).
//
// BYO lets a paid lab upload its OWN static website (raw HTML/CSS/JS, e.g. a
// paper's companion site) instead of authoring native markdown pages. It is a
// strict SUBSET of the lab-sites surface, so its server + client gates are layered
// ON TOP of the lab-sites gates: a BYO surface requires BOTH isLabSitesEnabled()
// (server) / LAB_SITES_ENABLED (client) AND the BYO flag below. With the BYO flag
// off the app is byte-identical: the upload + serve routes 404, the dashboard BYO
// control is absent.
//
// Mirrors the LAB_SITES split exactly (server gate read lazily, client gate inlined
// at build time), and is kept SEPARATE so BYO can ship behind its own switch after
// the native lab-sites surface goes live.

/**
 * SERVER gate for BYO static-site routes (upload + serve). Read lazily at request
 * time. A BYO route must check BOTH isLabSitesEnabled() AND this, fail-closed.
 */
export function isLabByoSitesEnabled(): boolean {
  return (
    isLabSitesEnabled() &&
    (process.env.LAB_BYO_SITES === "1" || process.env.LAB_BYO_SITES === "true")
  );
}

/** CLIENT gate for BYO upload UI. Inlined at build time, default OFF. The BYO UI
 *  must also be inside a LAB_SITES_ENABLED surface, so callers gate on both. */
export const LAB_BYO_SITES_ENABLED =
  LAB_SITES_ENABLED &&
  (process.env.NEXT_PUBLIC_LAB_BYO_SITES === "1" ||
    process.env.NEXT_PUBLIC_LAB_BYO_SITES === "true");
