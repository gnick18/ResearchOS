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

/**
 * Community-contribution provenance + wiki-style verification state. ABSENT on
 * the curated PhyloPic/BioIcons seed (treated as "curated" / trusted). Present on
 * community submissions, which auto-publish "unverified" until an INDEPENDENT
 * user (never the submitter) vouches for them.
 */
export interface AssetVerification {
  status: "curated" | "unverified" | "verified";
  /** @handles of the independent users who vouched. */
  verifiedBy?: string[];
  /** ISO timestamp of the first vouch. */
  verifiedAt?: string;
  /** Count of "this looks wrong" reports, for the auto-pull threshold. */
  flags?: number;
}

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
  /** Brand/trademark logo (Devicon). Keeps its original colors; the UI must not offer recolor. */
  isLogo?: boolean;
  /** Contributor @handle for a community submission; null/absent for the curated seed. */
  submittedBy?: string | null;
  /** Wiki-style verification state. Absent on the curated seed (treated as "curated"). */
  verification?: AssetVerification;
}

/**
 * Removal record for a community asset a reviewer rejected. Mirrors the Trash
 * 30-day pattern: the asset leaves the live community manifest and lands in a
 * separate community-removed.json, retained REMOVAL_RETENTION_DAYS so any signed
 * -in user can revert it. After the window a GC pass purges the SVG + record.
 * The reviewer's handle and written reason are kept the whole time (audit trail).
 */
export interface AssetRemoval {
  /** ISO timestamp of the rejection. */
  removedAt: string;
  /** @handle of the reviewer who rejected it (the accountable actor). */
  removedBy: string;
  /** The required written reason for the rejection. */
  reason: string;
  /** removedAt + REMOVAL_RETENTION_DAYS; when the GC pass purges it for good. */
  autoExpiresAt: string;
}

/** A community asset currently inside the 30-day removal window. */
export type RemovedAsset = LibraryAsset & { removal: AssetRemoval };

/** How long a rejected community asset is retained + revertible before GC. */
export const REMOVAL_RETENTION_DAYS = 30;

/** Whole days left before a removed asset is permanently purged (0 = expired). */
export function removalDaysLeft(removal: AssetRemoval, now: number = Date.now()): number {
  const ms = Date.parse(removal.autoExpiresAt) - now;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** The verification status of an asset, defaulting the curated seed to "curated". */
export function verificationStatus(asset: LibraryAsset): AssetVerification["status"] {
  return asset.verification?.status ?? "curated";
}

/** Absolute URL of an asset's SVG on the CDN. */
export function assetSvgUrl(asset: Pick<LibraryAsset, "svgPath">): string {
  return `${ASSET_BASE_URL}/${asset.svgPath}`;
}

// Manifest fetch is cached for the page lifetime (the bundle is immutable per deploy).
let manifestPromise: Promise<LibraryAsset[]> | null = null;

/** Fetch one manifest file from the CDN. Returns [] on any failure (missing file ok). */
async function fetchManifestFile(name: string): Promise<LibraryAsset[]> {
  try {
    // "default" (revalidate per the CDN's Cache-Control), NOT force-cache: the
    // manifest GROWS (re-ingests + community contributions), and surfaces like the
    // landing show a live asset count, so a once-cached-forever response would go
    // permanently stale. Per-asset SVGs stay force-cached (immutable by id).
    const res = await fetch(`${ASSET_BASE_URL}/${name}`, { cache: "default" });
    if (!res.ok) return [];
    const data = (await res.json()) as LibraryAsset[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Load + cache the asset manifest from the CDN. Merges the CURATED seed
 * (manifest.json, written only by the ingest) with the COMMUNITY submissions
 * (community-manifest.json, written by the contribution endpoint). The two files
 * are kept separate so user input never rewrites the trusted seed; this merge is
 * the only place they come together. A missing community manifest is fine (the
 * feature may not be live yet) and just yields the curated set.
 */
export async function loadAssetManifest(): Promise<LibraryAsset[]> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const [curated, community] = await Promise.all([
        fetchManifestFile("manifest.json"),
        fetchManifestFile("community-manifest.json"),
      ]);
      return [...curated, ...community];
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

// ---------------------------------------------------------------------------
// Grouped taxonomy. Flat category chips stop scaling as the corpus grows, so the
// picker (and the /library landing) want a BioRender-style collapsible TREE:
// a handful of top-level sections, each holding the fine-grained categories the
// ingest produces. This canonical map is the single source of the section shape;
// both the figure-composer picker and the landing render from listCategoryGroups.
// A category not listed here falls into "Other" so nothing is ever hidden.
// ---------------------------------------------------------------------------

/** A top-level section and the categories under it that are present in a manifest. */
export interface CategoryGroup {
  section: string;
  categories: string[];
}

/** Canonical section -> member-categories map, in display order. */
const CATEGORY_SECTIONS: { section: string; categories: string[] }[] = [
  {
    section: "Organisms",
    categories: [
      "Mammals", "Birds", "Reptiles", "Amphibians", "Fishes", "Insects", "Arachnids",
      "Crustaceans", "Myriapods", "Molluscs", "Cnidarians", "Echinoderms", "Worms",
      "Other invertebrates", "Plants & algae", "Fungi", "Bacteria & archaea", "Protists",
      "Other organisms", "Animals",
    ],
  },
  { section: "Microbes & pathogens", categories: ["Microbiology", "Viruses", "Parasites"] },
  {
    section: "Cells & tissues",
    categories: [
      "Cell types", "Cell lines", "Cell culture", "Cell membrane",
      "Intracellular components", "Tissues", "Extracellular matrix",
    ],
  },
  {
    section: "Molecular",
    categories: [
      "Nucleic acids", "Amino acids", "Peptides", "Receptors & channels",
      "Molecular modelling", "Molecular biology", "Genetics", "Genomics", "Epigenetics",
    ],
  },
  {
    section: "Anatomy & physiology",
    categories: ["Human physiology", "Blood & immunology", "Oncology", "Neuroscience"],
  },
  { section: "Lab & methods", categories: ["Lab apparatus", "Procedures", "Imaging", "Safety symbols"] },
  { section: "Chemistry", categories: ["Chemistry"] },
  { section: "Physics, math & electronics", categories: ["Physics", "Math", "Electronics"] },
  {
    section: "Data & informatics",
    categories: ["Scientific graphs", "Bioinformatics", "Machine learning", "Computer hardware", "Nanotechnology"],
  },
  { section: "People & general", categories: ["People", "General"] },
];

/** category -> section, derived once from CATEGORY_SECTIONS. */
const SECTION_BY_CATEGORY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const g of CATEGORY_SECTIONS) for (const c of g.categories) m[c] = g.section;
  return m;
})();

const OTHER_SECTION = "Other";

/** The section a category belongs to ("Other" when unmapped, e.g. a novel community tag). */
export function sectionForCategory(category: string | null | undefined): string {
  if (!category) return OTHER_SECTION;
  return SECTION_BY_CATEGORY[category] ?? OTHER_SECTION;
}

/**
 * Group the categories PRESENT in a manifest into the canonical sections, in
 * display order, each with its categories sorted. Empty sections are omitted, and
 * any unmapped category collects under a trailing "Other" section. This is what a
 * collapsible grouped category tree renders from.
 */
export function listCategoryGroups(assets: LibraryAsset[]): CategoryGroup[] {
  const present = new Set(listCategories(assets));
  const groups: CategoryGroup[] = [];
  for (const g of CATEGORY_SECTIONS) {
    const cats = g.categories.filter((c) => present.has(c)).sort();
    if (cats.length) groups.push({ section: g.section, categories: cats });
  }
  const other = [...present].filter((c) => !(c in SECTION_BY_CATEGORY)).sort();
  if (other.length) groups.push({ section: OTHER_SECTION, categories: other });
  return groups;
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

/** Community assets awaiting an independent review. */
export function reviewableAssets(
  assets: LibraryAsset[],
  viewerHandle?: string | null,
): LibraryAsset[] {
  return assets.filter(
    (a) =>
      verificationStatus(a) === "unverified" &&
      // The submitter cannot review their own work, so exclude it from a viewer's queue.
      (!viewerHandle || a.submittedBy !== viewerHandle),
  );
}

/** Count of reviewable community assets, for the picker's "Help review (N)" badge. */
export function countReviewable(assets: LibraryAsset[], viewerHandle?: string | null): number {
  return reviewableAssets(assets, viewerHandle).length;
}
