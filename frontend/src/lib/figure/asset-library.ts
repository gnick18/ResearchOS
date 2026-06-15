// The open scientific-asset library client. Reads the ingested asset bundle
// (manifest + per-asset SVGs) served from the Cloudflare R2 CDN, and offers pure
// search / filter / credit helpers the composer's icon picker plugs into.
//
// The bundle is produced by frontend/scripts/asset-ingest/ and synced to R2; the
// app only ever READS it over https. Per-asset provenance (source + license +
// attribution + credit) rides on every entry so the figure can auto-cite.
//
// Gated by ASSET_LIBRARY_ENABLED (default off) until the in-composer UI is built
// and verified. The base URL is env-driven with the live CDN as the fallback.
//
// No em-dashes, no emojis, no mid-sentence colons.

/** The base URL of the asset CDN. Defaults to the live R2 custom domain. */
export const ASSET_BASE_URL =
  process.env.NEXT_PUBLIC_ASSET_BASE_URL || "https://assets.research-os.com";

/** Feature gate for the in-composer asset/icon library UI. Default OFF. */
export const ASSET_LIBRARY_ENABLED =
  process.env.NEXT_PUBLIC_ASSET_LIBRARY_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_LIBRARY_ENABLED === "true";

/** One library asset, mirroring an entry in the ingest bundle's manifest.json. */
export interface LibraryAsset {
  /** Stable cross-source id, "<source>:<sourceId>". */
  uid: string;
  source: string;
  sourceId: string;
  title: string;
  creator: string | null;
  /** Normalized license id (CC0 / Public Domain / CC-BY / CC-BY-SA / MIT / BSD). */
  license: string;
  licenseUrl: string | null;
  requiresAttribution: boolean;
  sourceUrl: string;
  /** Pre-formatted verbatim citation string. */
  credit: string;
  /** Relative path of the SVG within the bundle (e.g. assets/phylopic/<id>.svg). */
  svgPath: string;
  tags: string[];
  category: string | null;
  /** Distinct fill colors in the SVG (1 = monochrome, drives single-tint vs per-fill). */
  fills: number;
  hasViewBox: boolean;
}

/** Absolute URL of an asset's SVG on the CDN. */
export function assetSvgUrl(asset: Pick<LibraryAsset, "svgPath">): string {
  return `${ASSET_BASE_URL}/${asset.svgPath}`;
}

// Manifest fetch is cached for the page lifetime (the bundle is immutable per deploy).
let manifestPromise: Promise<LibraryAsset[]> | null = null;

/** Load + cache the asset manifest from the CDN. Returns [] on any failure. */
export async function loadAssetManifest(): Promise<LibraryAsset[]> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const res = await fetch(`${ASSET_BASE_URL}/manifest.json`, { cache: "force-cache" });
        if (!res.ok) return [];
        const data = (await res.json()) as LibraryAsset[];
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    })();
  }
  return manifestPromise;
}

/** Test-only reset of the manifest cache. */
export function _resetAssetManifestCache(): void {
  manifestPromise = null;
}

/** Fetch one asset's raw SVG text (for inlining + recolor). Null on failure. */
export async function fetchAssetSvg(asset: Pick<LibraryAsset, "svgPath">): Promise<string | null> {
  try {
    // The picker thumbnails request the bare SVG URL via <img> with NO Origin
    // header, so the CDN (Cloudflare in front of R2) can cache that response
    // WITHOUT Access-Control-Allow-Origin. A later cross-origin fetch() then
    // fails on the cached header-less variant ("Failed to fetch") and the placed
    // icon renders empty. A fetch-only query suffix gives this request its OWN
    // cache entry, only ever populated by Origin-bearing fetches, so it always
    // carries the CORS header (and still caches). The bare <img> URL is untouched.
    // The proper long-term fix is an unconditional Access-Control-Allow-Origin on
    // the assets domain (a CDN response-header rule); this keeps icons working now.
    const res = await fetch(`${assetSvgUrl(asset)}?cors=1`, { cache: "force-cache" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Distinct categories present in a manifest, sorted, for the picker's filter chips. */
export function listCategories(assets: LibraryAsset[]): string[] {
  return [...new Set(assets.map((a) => a.category).filter((c): c is string => !!c))].sort();
}

/** Distinct sources present, for grouping / source filter. */
export function listSources(assets: LibraryAsset[]): string[] {
  return [...new Set(assets.map((a) => a.source))].sort();
}

/** Pure search + filter over a manifest. Empty query/filters = pass-through. */
export function searchAssets(
  assets: LibraryAsset[],
  opts: { query?: string; category?: string | null; source?: string | null } = {},
): LibraryAsset[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return assets.filter((a) => {
    if (opts.category && a.category !== opts.category) return false;
    if (opts.source && a.source !== opts.source) return false;
    if (terms.length === 0) return true;
    const hay = `${a.title} ${a.category ?? ""} ${a.tags.join(" ")} ${a.creator ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
