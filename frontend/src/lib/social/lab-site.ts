// Lab companion-site pure logic (lab-domains Phase 2, social lane).
//
// Browser-safe, dependency-free helpers for the static markdown companion sites:
// page-path normalization and the public-visibility DECISION (given a resolved
// site, a slug-registry row, and a page row, should the public route render it or
// notFound). Kept pure so the routing/gating behavior is unit-tested without a
// database or Next.js runtime; the DB layer (lab-site-db.ts) and the route both
// call into here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { SlugKind } from "./slug-registry";

/** A page's publish state. Only "published" is publicly viewable. */
export type PageStatus = "draft" | "published";

/** Max characters in a single path segment (defensive bound). */
export const PAGE_SEGMENT_MAX = 64;

/** Max number of nested segments in a page path. */
export const PAGE_DEPTH_MAX = 8;

/**
 * Canonicalizes a page path into the stored form. The home page is the empty
 * string "". Otherwise it is a slash-joined sequence of lowercased segments,
 * each restricted to [a-z0-9-], with no leading/trailing/duplicate slashes.
 *
 * Rules per segment mirror normalizeSlug (so paths and slugs share a character
 * grammar): lowercase, any run of non [a-z0-9] becomes a single dash, repeated
 * dashes collapse, leading/trailing dashes stripped, truncated to
 * PAGE_SEGMENT_MAX. Empty segments (from "//", "." , "..", or all-punctuation)
 * are dropped, which also neutralizes traversal attempts. Depth is capped at
 * PAGE_DEPTH_MAX; extra segments are dropped.
 *
 * Pure and idempotent. Accepts either a string path or an array of raw segments
 * (Next.js catch-all params arrive as string[]).
 */
export function normalizePagePath(input: string | string[] | undefined): string {
  if (input == null) return "";
  const rawSegments = Array.isArray(input) ? input : input.split("/");
  const out: string[] = [];
  for (const raw of rawSegments) {
    if (typeof raw !== "string") continue;
    let s = raw.trim().toLowerCase();
    s = s.replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/-{2,}/g, "-");
    s = s.replace(/^-+|-+$/g, "");
    if (s.length > PAGE_SEGMENT_MAX) {
      s = s.slice(0, PAGE_SEGMENT_MAX).replace(/-+$/g, "");
    }
    if (s.length === 0) continue;
    out.push(s);
    if (out.length >= PAGE_DEPTH_MAX) break;
  }
  return out.join("/");
}

/**
 * The minimal shape of a slug-registry row this lane needs to decide rendering.
 * Mirrors lib/social/slug-registry-db.ts SlugRow without importing the DB module
 * (keeps this pure module free of any server-only dependency).
 */
export interface ResolvableSlugRow {
  slug: string;
  kind: SlugKind;
  ownerKey: string | null;
}

/** The minimal page shape needed for the visibility decision. */
export interface ResolvablePage {
  status: PageStatus;
}

/**
 * The outcome of resolving a public `/<slug>/<path>` request. "render" means the
 * route should render the page; every other variant means notFound(), but the
 * reason is returned so tests (and any future telemetry) can distinguish WHY,
 * and so the route never accidentally renders on a near-miss.
 */
export type PublicResolution =
  | { kind: "render" }
  | { kind: "not-found"; reason: "flag-off" }
  | { kind: "not-found"; reason: "slug-missing" }
  | { kind: "not-found"; reason: "slug-not-lab" }
  | { kind: "not-found"; reason: "no-site" }
  | { kind: "not-found"; reason: "page-missing" }
  | { kind: "not-found"; reason: "page-not-published" };

/**
 * The single source of truth for whether the public lab-site route renders. Pure
 * so it can be unit-tested exhaustively without a DB or Next runtime; the route
 * does the IO (flag read, registry lookup, page lookup) and feeds the results
 * here, then maps "render" to the page and anything else to notFound().
 *
 * The contract (from the Phase 2 spec):
 *   - flag OFF                       => not-found (route is inert / 404)
 *   - slug not in registry           => not-found
 *   - slug present but kind != "lab" => not-found (handle/institution/reserved
 *                                       slugs never route to a lab site)
 *   - no lab_sites row for the slug  => not-found
 *   - page does not exist            => not-found
 *   - page exists but status=draft   => not-found (only published is public)
 *   - all of the above hold          => render
 */
export function resolvePublicPage(args: {
  flagEnabled: boolean;
  slugRow: ResolvableSlugRow | null;
  hasSite: boolean;
  page: ResolvablePage | null;
}): PublicResolution {
  if (!args.flagEnabled) return { kind: "not-found", reason: "flag-off" };
  if (!args.slugRow) return { kind: "not-found", reason: "slug-missing" };
  if (args.slugRow.kind !== "lab") {
    return { kind: "not-found", reason: "slug-not-lab" };
  }
  if (!args.hasSite) return { kind: "not-found", reason: "no-site" };
  if (!args.page) return { kind: "not-found", reason: "page-missing" };
  if (args.page.status !== "published") {
    return { kind: "not-found", reason: "page-not-published" };
  }
  return { kind: "render" };
}
