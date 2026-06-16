// Lab companion-site baked block snapshots, pure shape + validation (lab-domains
// Phase 3b, social lane).
//
// A PUBLIC companion-site reader has no account and no local workspace, so a LIVE
// block embed (which reads the author's local data) can never render for them.
// Publishing therefore BAKES each embed into a frozen snapshot (the same
// BakedEmbed shape the PDF export and the pin sidecar produce), and the public
// page renders the baked snapshots, never live embeds. Baking is the citation-
// safety mechanism: the public reader sees exactly what the author froze.
//
// This module is the PURE core: the on-the-wire snapshot-bundle shape, the
// defensive validation that turns an untrusted JSON blob (from the request body
// or the database column) into a safe Record<href, BakedEmbed>, and the
// resolution helper the public render uses to look a baked embed up by href.
// Pure + IO-free so the publish-stores-snapshots path and the public baked-render
// resolution are unit-testable without Next.js, a database, or a browser canvas.
//
// The baking itself (bakeAllEmbeds) runs CLIENT-SIDE in the author's browser
// because svgToPngDataUrl needs a real canvas, so server-side baking is
// impossible. The author bakes, then sends the bundle here for validation +
// storage alongside the publish request.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { BakedEmbed } from "@/lib/export/bake-embeds";

/**
 * The snapshot bundle stored with one published page version. `version` mirrors
 * the page row's version at publish time (a stored bundle older than the page is
 * treated as stale, so a re-publish without snapshots cannot leave a public page
 * showing a previous bake). `snapshots` is keyed by the EXACT embed link href,
 * the same key bakeAllEmbeds returns, so the public render looks an embed up by
 * the href it parsed from the markdown.
 */
export interface SnapshotBundle {
  version: 1;
  /** href -> frozen BakedEmbed. The href is the markdown link destination. */
  snapshots: Record<string, BakedEmbed>;
}

/** Hard cap on the number of baked embeds in one page bundle (defensive bound,
 *  generous for a static page). Extra entries past the cap are dropped. */
export const MAX_SNAPSHOTS_PER_PAGE = 200;

/** Hard cap on a single serialized snapshot bundle, defensive against a giant
 *  data-URL payload. A bundle over this size is rejected (treated as no
 *  snapshots) rather than stored. ~8 MB covers many hi-res PNG figures. */
export const MAX_SNAPSHOT_BUNDLE_BYTES = 8_000_000;

/** The empty-but-valid bundle, returned for an absent or malformed input. */
export function emptyBundle(): SnapshotBundle {
  return { version: 1, snapshots: {} };
}

/** True when a value is a plausible BakedEmbed. Defensive, a hand-edited or
 *  partially-written record must never throw at a render site, so anything that
 *  is not a recognized kind is rejected (the embed then renders the calm
 *  unavailable card via the missing fallback at the render layer). */
export function isBakedEmbed(value: unknown): value is BakedEmbed {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown };
  switch (v.kind) {
    case "image": {
      const e = value as { dataUrl?: unknown; width?: unknown; height?: unknown };
      return (
        typeof e.dataUrl === "string" &&
        typeof e.width === "number" &&
        typeof e.height === "number"
      );
    }
    case "table": {
      const e = value as { columns?: unknown; rows?: unknown };
      return Array.isArray(e.columns) && Array.isArray(e.rows);
    }
    case "text": {
      const e = value as { body?: unknown };
      return typeof e.body === "string";
    }
    case "card": {
      const e = value as { title?: unknown; meta?: unknown };
      return typeof e.title === "string" && Array.isArray(e.meta);
    }
    case "missing": {
      const e = value as { name?: unknown };
      return typeof e.name === "string";
    }
    default:
      return false;
  }
}

/**
 * Validate an untrusted snapshot bundle (from the publish request body or the
 * database column) into a safe SnapshotBundle. Never throws: a wrong shape, a
 * non-string href, or a non-BakedEmbed value is dropped, and the whole thing
 * collapses to the empty bundle when it is not even an object. The cap bounds
 * the entry count so a malicious or buggy client cannot store an unbounded map.
 *
 * Accepts either an already-parsed object or a raw JSON string (the DB column is
 * text); a string that does not parse yields the empty bundle.
 */
export function parseSnapshotBundle(input: unknown): SnapshotBundle {
  let value = input;
  if (typeof value === "string") {
    if (value.length > MAX_SNAPSHOT_BUNDLE_BYTES) return emptyBundle();
    try {
      value = JSON.parse(value);
    } catch {
      return emptyBundle();
    }
  }
  if (!value || typeof value !== "object") return emptyBundle();
  const v = value as { version?: unknown; snapshots?: unknown };
  if (v.version !== 1) return emptyBundle();
  if (!v.snapshots || typeof v.snapshots !== "object") return emptyBundle();

  const out: Record<string, BakedEmbed> = {};
  let count = 0;
  for (const [href, snap] of Object.entries(v.snapshots as Record<string, unknown>)) {
    if (typeof href !== "string" || href.length === 0) continue;
    if (!isBakedEmbed(snap)) continue;
    out[href] = snap;
    count += 1;
    if (count >= MAX_SNAPSHOTS_PER_PAGE) break;
  }
  return { version: 1, snapshots: out };
}

/**
 * Serialize a snapshot bundle for storage in the text column. Returns the JSON
 * string, or null when the serialized form exceeds the byte cap (the caller
 * stores no snapshots rather than a truncated blob, and the public page then
 * shows the calm unavailable card per embed, never a crash).
 */
export function serializeSnapshotBundle(bundle: SnapshotBundle): string | null {
  const json = JSON.stringify(bundle);
  if (json.length > MAX_SNAPSHOT_BUNDLE_BYTES) return null;
  return json;
}

/**
 * Build a SnapshotBundle from a baked map (the Map<href, BakedEmbed> that
 * bakeAllEmbeds returns in the browser) tagged with the page version it was
 * baked for. The author client calls this, serializes the result, and sends it
 * with the publish request.
 */
export function bundleFromBakedMap(
  baked: Map<string, BakedEmbed>,
): SnapshotBundle {
  const snapshots: Record<string, BakedEmbed> = {};
  let count = 0;
  for (const [href, snap] of baked) {
    snapshots[href] = snap;
    count += 1;
    if (count >= MAX_SNAPSHOTS_PER_PAGE) break;
  }
  return { version: 1, snapshots };
}

/**
 * Look up the baked snapshot for one embed href in a parsed bundle. Null when the
 * bundle has no snapshot for that href (the public render then shows the calm
 * "content unavailable" card, never a live embed and never a crash). This is the
 * single resolution point the public render uses, kept pure so the
 * missing-snapshot fallback is unit-tested without React.
 */
export function resolveSnapshot(
  bundle: SnapshotBundle | null,
  href: string,
): BakedEmbed | null {
  if (!bundle) return null;
  return bundle.snapshots[href] ?? null;
}
