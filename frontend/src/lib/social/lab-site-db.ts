// Lab companion-site pages, Neon persistence (lab-domains Phase 2, social lane).
//
// The data layer for static markdown companion sites. A lab (referenced ONLY by
// its billing owner-key hash, never a new identity) owns ONE site; a site owns
// many pages addressed by path. Phase 2 stores plain markdown bodies (body_md);
// the live-visualizer block system is Phase 3 and the frozen-snapshot/R2 asset
// columns are Phases 3-5, so they are intentionally absent here.
//
// Conventions mirror lib/social/slug-registry-db.ts and lib/sharing/directory/db.ts:
// a lazily-constructed Neon singleton from DATABASE_URL (so importing this during
// build or tsc never needs the connection string), idempotent CREATE TABLE IF NOT
// EXISTS schema creation callable on every route entry, and parameterized
// tagged-template queries.
//
// This module does NOT import lib/sharing/identity/**, lib/sharing/directory/**
// schema, or lib/billing/** write paths. A lab is referenced only by its
// lab_owner_key (ownerKeyForEmail from lib/billing/owner.ts) passed in as a plain
// string. The lab slug references the Phase 1 slug_registry (kind=lab); this
// module trusts the caller to have reserved the slug there first.
//
// The pure resolution/decision logic (which page a request maps to, and whether
// it is publicly viewable) lives in lab-site.ts so it is unit-testable without a
// database; this module is the thin DB layer.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { setHostedAssetBytes } from "@/lib/collab/server/db";
import { normalizePagePath, type PageStatus } from "./lab-site";
import { hostedAssetId } from "./lab-site-hosted";
import {
  ensureSlugRegistrySchema,
  reserveSlug,
} from "./slug-registry-db";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily constructs the Neon query function from DATABASE_URL. Throws a clear
 * error if the connection string is missing so a misconfigured deployment fails
 * at request time rather than producing a confusing driver error. Never called
 * at module load, so tsc and the pure unit tests do not need a database.
 */
function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The lab-site store cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** A lab_sites row as stored. One site per lab. */
export interface LabSiteRow {
  labOwnerKey: string;
  labSlug: string;
  createdAt: string;
  /**
   * The owner's published badge snapshot for this lab, as raw JSON text
   * (serialized by serializeBadgeSnapshot). Null when the owner has never
   * published badges. The public page parses this via parseBadgeSnapshotJson
   * and renders BadgePublicView; a null column renders nothing.
   */
  badgeSnapshotJson: string | null;
}

/** A lab_site_pages row as stored. */
export interface LabSitePageRow {
  labOwnerKey: string;
  path: string;
  title: string;
  bodyMd: string;
  status: PageStatus;
  version: number;
  updatedAt: string;
  /**
   * The frozen baked-block snapshots for this page version, as the raw JSON text
   * stored in the snapshots_json column, or null when none were baked (a
   * text-only page or a page published before Phase 3b). The public render parses
   * this through parseSnapshotBundle (lab-site-snapshots.ts) and resolves each
   * embed to a frozen BakedEmbed instead of a live embed. Phase 3b: baking runs
   * CLIENT-SIDE (canvas), so the author sends the bundle and this layer just
   * stores it.
   */
  snapshotsJson: string | null;
  /**
   * The hosted dataset-asset manifest for this page version, as the raw JSON text
   * stored in the hosted_json column, or null when no datasets are hosted (a page
   * with no live data, or one published before Phase 4a). The public render parses
   * this through parseHostedManifest (lab-site-hosted.ts) and renders the LIVE
   * DuckDB-WASM viewer for any embed href with a hosted asset, falling back to the
   * Phase 3b baked snapshot otherwise. Phase 4a: the author uploads the Parquet to
   * R2 CLIENT-SIDE and sends this manifest, and this layer just stores it.
   */
  hostedJson: string | null;
  /**
   * The block-based page body (P1 companion builder), as the raw JSON text stored
   * in the blocks_json column. When non-null, the page is a BLOCKS page and
   * blocks_json is the canonical body. When null, the page is a MARKDOWN page and
   * body_md is rendered. Pages are either one or the other; the write helpers
   * enforce this by clearing the other column on each save. Callers parse via
   * parseLabSiteBlocks (lab-site-blocks.ts).
   */
  blocksJson: string | null;
}

/**
 * Creates the lab_sites and lab_site_pages tables if they do not already exist.
 * Idempotent, so every route can call it on entry without a migration step.
 *
 * lab_sites: one row per lab, keyed by the billing owner-key hash. lab_slug is
 * the Phase 1 registry slug (kept here too so a public render can resolve a page
 * straight from the slug without a registry join, and so a slug rename is a
 * single update). A unique index on lab_slug keeps the slug -> site mapping 1:1.
 *
 * lab_site_pages: keyed by (lab_owner_key, path). path is the normalized URL
 * path under the slug ("" / "" is the home page). status is draft|published;
 * only published pages are publicly viewable. version increments on each publish
 * (Phase 3 surfaces history; Phase 2 just tracks it).
 */
export async function ensureLabSiteSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_sites (
      lab_owner_key text primary key,
      lab_slug      text not null,
      created_at    timestamptz default now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_sites_slug
      ON lab_sites(lab_slug)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS lab_site_pages (
      lab_owner_key text not null,
      path          text not null,
      title         text not null default '',
      body_md       text not null default '',
      status        text not null default 'draft',
      version       integer not null default 1,
      updated_at    timestamptz default now(),
      primary key (lab_owner_key, path)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_lab_site_pages_owner
      ON lab_site_pages(lab_owner_key)
  `;
  // Phase 3b: the frozen baked-block snapshots for the published page version.
  // Added as a nullable column via IF NOT EXISTS so the schema-ensure stays
  // idempotent and a pre-3b deployment migrates forward in place (no data move,
  // existing rows keep snapshots_json = NULL = "no baked blocks").
  await sql`
    ALTER TABLE lab_site_pages
      ADD COLUMN IF NOT EXISTS snapshots_json text
  `;
  // Phase 4a: the hosted dataset-asset manifest for the published page version.
  // Added as a nullable column via IF NOT EXISTS so the schema-ensure stays
  // idempotent and a pre-4a deployment migrates forward in place (existing rows
  // keep hosted_json = NULL = "no hosted datasets", so the public render falls
  // back to the baked snapshot per embed, exactly as Phase 3b).
  await sql`
    ALTER TABLE lab_site_pages
      ADD COLUMN IF NOT EXISTS hosted_json text
  `;
  // Badges publish path: the owner's published badge snapshot for this lab.
  // Stored at the lab level (lab_sites) because badges represent the lab's
  // overall earned activity, not any individual page. Added as a nullable
  // column via IF NOT EXISTS so the schema-ensure stays idempotent; existing
  // rows keep badge_snapshot_json = NULL = "no published snapshot", and the
  // public page renders nothing for badges (BadgePublicView no-ops on an empty
  // snapshot). The column is written only when the owner explicitly publishes.
  await sql`
    ALTER TABLE lab_sites
      ADD COLUMN IF NOT EXISTS badge_snapshot_json text
  `;
  // P1 companion-builder: the block-based page representation. Pages are
  // EITHER markdown (body_md) OR blocks (blocks_json); whichever column is
  // non-null takes precedence in the renderer. Added as a nullable column via
  // IF NOT EXISTS so the schema-ensure stays idempotent and a pre-P1
  // deployment migrates forward in place (existing rows keep blocks_json = NULL
  // = "markdown page", so the public render falls back to body_md per page).
  // body_md is kept untouched for the life of the markdown authoring path.
  await sql`
    ALTER TABLE lab_site_pages
      ADD COLUMN IF NOT EXISTS blocks_json text
  `;
}

function rowToSite(r: {
  lab_owner_key: string;
  lab_slug: string;
  created_at: string;
  badge_snapshot_json?: string | null;
}): LabSiteRow {
  return {
    labOwnerKey: r.lab_owner_key,
    labSlug: r.lab_slug,
    createdAt: r.created_at,
    badgeSnapshotJson: r.badge_snapshot_json ?? null,
  };
}

/** The raw shape of a lab_site_pages SELECT, including the Phase 3b+ columns. */
interface RawPageRow {
  lab_owner_key: string;
  path: string;
  title: string;
  body_md: string;
  status: string;
  version: string | number;
  updated_at: string;
  snapshots_json?: string | null;
  hosted_json?: string | null;
  blocks_json?: string | null;
}

function rowToPage(r: RawPageRow): LabSitePageRow {
  return {
    labOwnerKey: r.lab_owner_key,
    path: r.path,
    title: r.title,
    bodyMd: r.body_md,
    status: r.status === "published" ? "published" : "draft",
    version: Number(r.version),
    updatedAt: r.updated_at,
    snapshotsJson: r.snapshots_json ?? null,
    hostedJson: r.hosted_json ?? null,
    blocksJson: r.blocks_json ?? null,
  };
}

// ---------------------------------------------------------------------------
// Site lookups
// ---------------------------------------------------------------------------

/**
 * Enumeration for the Phase 4b hosted-asset GC. Returns one row per lab site,
 * each carrying the lab's owner key and the raw hosted_json text of EVERY page in
 * that site (draft or published) that has a non-null hosted manifest. The GC
 * runner parses each blob via parseHostedManifest (lab-site-hosted.ts) to recover
 * the live R2 asset ids, so the parse stays in the pure module and this layer is a
 * thin read.
 *
 * BOUNDARY: this reads only the social lane's own tables (lab_sites +
 * lab_site_pages). It deliberately does NOT join Billing's lab_hosted_assets
 * table. An asset row that was orphaned from a dropped embed (registered in
 * Billing but no longer referenced by any current page manifest) is therefore NOT
 * enumerated here; reconciling those orphans is a known follow-up (see the Phase
 * 4b handoff).
 *
 * The list can be large in principle but is bounded by the number of labs with a
 * site; each lab's manifests are small metadata blobs (no Parquet bytes), so this
 * is a light scan suitable for a scheduled job.
 */
export interface LabSiteHostedManifests {
  labOwnerKey: string;
  /** Raw hosted_json text of each page in the site that has a manifest. */
  hostedJsonByPath: Array<{ path: string; hostedJson: string }>;
}

export async function listAllSiteHostedManifests(): Promise<
  LabSiteHostedManifests[]
> {
  await ensureLabSiteSchema();
  const sql = getSql();
  // One scan: every site joined to its pages that carry a hosted manifest. A site
  // with no hosted pages still appears (LEFT JOIN) so the GC sees the lab exists
  // but has nothing to reclaim, which keeps the runner uniform. Ordered by owner
  // so the grouping below is a single linear pass.
  const rows = (await sql`
    SELECT s.lab_owner_key AS lab_owner_key,
           p.path          AS path,
           p.hosted_json   AS hosted_json
    FROM lab_sites s
    LEFT JOIN lab_site_pages p
      ON p.lab_owner_key = s.lab_owner_key
     AND p.hosted_json IS NOT NULL
    ORDER BY s.lab_owner_key
  `) as Array<{
    lab_owner_key: string;
    path: string | null;
    hosted_json: string | null;
  }>;

  const byOwner = new Map<string, LabSiteHostedManifests>();
  for (const r of rows) {
    let entry = byOwner.get(r.lab_owner_key);
    if (!entry) {
      entry = { labOwnerKey: r.lab_owner_key, hostedJsonByPath: [] };
      byOwner.set(r.lab_owner_key, entry);
    }
    if (r.hosted_json != null && r.path != null) {
      entry.hostedJsonByPath.push({ path: r.path, hostedJson: r.hosted_json });
    }
  }
  return Array.from(byOwner.values());
}

/** Fetches the site for a lab owner-key, or null if none exists yet. */
export async function getSiteByOwner(
  labOwnerKey: string,
): Promise<LabSiteRow | null> {
  if (!labOwnerKey) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, lab_slug, created_at, badge_snapshot_json
    FROM lab_sites
    WHERE lab_owner_key = ${labOwnerKey}
    LIMIT 1
  `) as Array<{ lab_owner_key: string; lab_slug: string; created_at: string; badge_snapshot_json?: string | null }>;
  return rows[0] ? rowToSite(rows[0]) : null;
}

/**
 * Fetches the site for a lab slug, or null. This is the public-render entry
 * point: a request for `/<labSlug>/...` resolves the owning lab from here. The
 * slug is matched exactly as stored (callers normalize via the registry).
 */
export async function getSiteBySlug(labSlug: string): Promise<LabSiteRow | null> {
  if (!labSlug) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, lab_slug, created_at, badge_snapshot_json
    FROM lab_sites
    WHERE lab_slug = ${labSlug}
    LIMIT 1
  `) as Array<{ lab_owner_key: string; lab_slug: string; created_at: string; badge_snapshot_json?: string | null }>;
  return rows[0] ? rowToSite(rows[0]) : null;
}

/**
 * Returns every claimed lab slug. Used by the domain-provision reconcile cron to
 * ensure each lab subdomain is registered on the Vercel project for its TLS cert.
 * Read-only, no schema change. Defensive empty array on a missing store so the
 * cron degrades to a no-op rather than throwing.
 */
export async function listAllSiteSlugs(): Promise<string[]> {
  await ensureLabSiteSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_slug FROM lab_sites ORDER BY lab_slug
  `) as Array<{ lab_slug: string }>;
  return rows.map((r) => r.lab_slug).filter((s): s is string => Boolean(s));
}

/**
 * Creates (or returns the existing) site row for a lab. Idempotent on
 * lab_owner_key. The slug must already be reserved in slug_registry as kind=lab
 * by the caller; this only records the site-to-slug mapping. If a DIFFERENT lab
 * already holds the slug (unique index conflict), the insert is a no-op and the
 * existing row is returned so the caller can detect the mismatch.
 */
export async function createSite(
  labOwnerKey: string,
  labSlug: string,
): Promise<LabSiteRow | null> {
  await ensureLabSiteSchema();
  const sql = getSql();
  await sql`
    INSERT INTO lab_sites (lab_owner_key, lab_slug)
    VALUES (${labOwnerKey}, ${labSlug})
    ON CONFLICT (lab_owner_key) DO UPDATE SET lab_slug = EXCLUDED.lab_slug
  `;
  return getSiteByOwner(labOwnerKey);
}

/**
 * Writes (or clears) the lab-level badge snapshot. Called by the badges PUT
 * endpoint after the owner confirms their pinned selection. Passing null clears
 * a previously published snapshot so the public page renders nothing for badges.
 *
 * The snapshot is a LAB-LEVEL field (one snapshot per lab, not per page) because
 * badges represent overall lab activity, not a single page's content.
 * ensureLabSiteSchema ensures the badge_snapshot_json column exists before any
 * write, so the first call on a pre-badges deployment migrates forward in place.
 */
export async function upsertLabBadgeSnapshot(
  labOwnerKey: string,
  badgeSnapshotJson: string | null,
): Promise<void> {
  if (!labOwnerKey) return;
  await ensureLabSiteSchema();
  const sql = getSql();
  await sql`
    UPDATE lab_sites
    SET badge_snapshot_json = ${badgeSnapshotJson}
    WHERE lab_owner_key = ${labOwnerKey}
  `;
}

// ---------------------------------------------------------------------------
// Page lookups + writes
// ---------------------------------------------------------------------------

/** Fetches a single page by owner + normalized path, or null. */
export async function getPage(
  labOwnerKey: string,
  path: string,
): Promise<LabSitePageRow | null> {
  if (!labOwnerKey) return null;
  const p = normalizePagePath(path);
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, path, title, body_md, status, version, updated_at, snapshots_json, hosted_json, blocks_json
    FROM lab_site_pages
    WHERE lab_owner_key = ${labOwnerKey} AND path = ${p}
    LIMIT 1
  `) as RawPageRow[];
  return rows[0] ? rowToPage(rows[0]) : null;
}

/**
 * A slim published-page entry used by the public nav and companion list. Only
 * path and title are fetched (no body, no snapshots) to keep the list query
 * light. Order follows the convention in lab-site-nav-order.ts: home first,
 * then "people", then "papers/*", then the rest alphabetically by path.
 */
export interface PublishedPageEntry {
  path: string;
  title: string;
}

/**
 * Returns the published pages for a lab, ordered for the public subnav (home,
 * people, papers, rest). Defensive: an empty array on any DB error so the route
 * degrades to "no nav" rather than 500. Read-only, no schema change.
 *
 * Callers pass the lab_owner_key resolved from the slug. This is the public
 * page-listing read the Phase 1 spec mandates (section 3.2 of the build spec).
 */
export async function listPublishedPages(
  labOwnerKey: string,
): Promise<PublishedPageEntry[]> {
  if (!labOwnerKey) return [];
  const sql = getSql();
  const rows = (await sql`
    SELECT path, title
    FROM lab_site_pages
    WHERE lab_owner_key = ${labOwnerKey} AND status = 'published'
    ORDER BY path
  `) as Array<{ path: string; title: string }>;
  // Apply the convention-driven order (home, people, papers/*, rest).
  return orderNavPages(rows.map((r) => ({ path: r.path, title: r.title })));
}

/**
 * Applies the convention-driven public subnav order so it is unit-testable
 * without a database. Home ("") always goes first; "people" second; any
 * "papers/*" path third, sorted among themselves by path; then the rest
 * alphabetically. The home path is the empty string ""; all others are
 * normalized slash-joined segments.
 */
export function orderNavPages(
  pages: PublishedPageEntry[],
): PublishedPageEntry[] {
  const rank = (path: string): number => {
    if (path === "") return 0;
    if (path === "people") return 1;
    if (path === "papers" || path.startsWith("papers/")) return 2;
    return 3;
  };
  return [...pages].sort((a, b) => {
    const ra = rank(a.path);
    const rb = rank(b.path);
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });
}

/** Lists all pages for a lab (any status), newest-updated first. The list does
 *  not carry snapshots_json bodies (the dashboard does not need them); rowToPage
 *  reads the column when present, but the SELECT here omits it to keep the list
 *  query light. snapshotsJson is therefore null on listed rows. */
export async function listPages(
  labOwnerKey: string,
): Promise<LabSitePageRow[]> {
  if (!labOwnerKey) return [];
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, path, title, body_md, status, version, updated_at
    FROM lab_site_pages
    WHERE lab_owner_key = ${labOwnerKey}
    ORDER BY updated_at DESC
  `) as RawPageRow[];
  return rows.map(rowToPage);
}

/**
 * Upserts a draft page (create or edit the body/title). Keyed on
 * (lab_owner_key, path). Does NOT change status to published (use publishPage),
 * but if a published page is edited this resets it to draft so edits are not
 * silently public until re-published. version is left untouched on a draft edit;
 * it advances on publish.
 */
export async function upsertPage(input: {
  labOwnerKey: string;
  path: string;
  title: string;
  bodyMd: string;
}): Promise<LabSitePageRow | null> {
  await ensureLabSiteSchema();
  const p = normalizePagePath(input.path);
  const sql = getSql();
  // A draft edit clears any stored snapshots AND hosted-asset manifest: the body
  // may have changed, so the previous bake / hosted-data pointers are stale and
  // must never resurface on the public page. The next publish re-bakes + re-uploads
  // from the new body. (Both columns NULL = "no baked blocks / no hosted data", so
  // the public render shows the calm unavailable card per embed until re-published.)
  await sql`
    INSERT INTO lab_site_pages (lab_owner_key, path, title, body_md, status, snapshots_json, hosted_json, updated_at)
    VALUES (${input.labOwnerKey}, ${p}, ${input.title}, ${input.bodyMd}, 'draft', NULL, NULL, now())
    ON CONFLICT (lab_owner_key, path) DO UPDATE SET
      title = EXCLUDED.title,
      body_md = EXCLUDED.body_md,
      status = 'draft',
      snapshots_json = NULL,
      hosted_json = NULL,
      updated_at = now()
  `;
  return getPage(input.labOwnerKey, p);
}

// ---------------------------------------------------------------------------
// Native-page storage metering (Part 1, per-site storage metering build)
// ---------------------------------------------------------------------------

/**
 * The site_key for a native lab-site page path. Matches the definition in the
 * storage-metering proposal:
 *   - "home" for the home page (path === "")
 *   - the page path for any other native page
 * BYO pages use "byo" (set by the BYO route, not here).
 *
 * Exported for unit tests.
 */
export function siteKeyForPath(path: string): string {
  const normalized = normalizePagePath(path);
  return normalized === "" ? "home" : normalized;
}

/**
 * The stable hosted-asset id for a native page's own content (not for embedded
 * datasets, which use hostedAssetId with their specific hrefs). Uses a
 * deterministic sentinel href "__native_page__" so re-publishing the same page
 * always yields the same billing row (no per-publish leak). The id shape is
 * identical to dataset asset ids and passes isValidAssetId.
 *
 * Exported for unit tests.
 */
export function pageNativeAssetId(
  labOwnerKey: string,
  pagePath: string,
): string {
  return hostedAssetId(labOwnerKey, pagePath, "__native_page__");
}

/**
 * The byte size of the stored native-page representation. Bytes are the
 * UTF-8 length of (blocks_json ?? body_md ?? "") plus (snapshots_json ?? "").
 * This matches what is actually persisted in Neon and what the PI billing
 * view will compare across pages.
 *
 * Exported for unit tests.
 */
export function nativePageBytes(
  blocksJson: string | null,
  bodyMd: string,
  snapshotsJson: string | null,
): number {
  const body = blocksJson ?? bodyMd ?? "";
  const snapshots = snapshotsJson ?? "";
  return Buffer.byteLength(body, "utf8") + Buffer.byteLength(snapshots, "utf8");
}

/**
 * Reports a native page's byte size to the hosted-asset billing table. Called
 * from publishPage after the DB write succeeds. Failures are swallowed (a
 * billing-report failure must never roll back or fail a publish). The metered
 * bytes equal nativePageBytes(blocksJson, bodyMd, snapshotsJson). The
 * site_key is siteKeyForPath(pagePath).
 */
async function meterNativePage(
  labOwnerKey: string,
  pagePath: string,
  blocksJson: string | null,
  bodyMd: string,
  snapshotsJson: string | null,
): Promise<void> {
  try {
    const assetId = pageNativeAssetId(labOwnerKey, pagePath);
    const bytes = nativePageBytes(blocksJson, bodyMd, snapshotsJson);
    const siteKey = siteKeyForPath(pagePath);
    await setHostedAssetBytes(assetId, labOwnerKey, bytes, siteKey);
  } catch {
    // A billing-report failure must not fail or roll back the publish.
    // The reconcile path can re-meter later.
  }
}

/**
 * Publishes a page: flips status to published, increments version, and stores the
 * frozen baked-block snapshots (Phase 3b). Returns the updated row, or null if
 * the page does not exist (publish only acts on an already-created draft). The
 * page must be created via upsertPage first.
 *
 * `hostedJson` is the already-validated, already-serialized hosted dataset-asset
 * manifest (Phase 4a): the author uploaded each dataset's Parquet to R2 CLIENT-
 * SIDE and the route validated the manifest via parseHostedManifest. Pass null
 * when no datasets are hosted. The column is always written so a re-publish never
 * leaves a previous manifest behind a newer body.
 *
 * `snapshotsJson` is the already-validated, already-serialized snapshot bundle
 * (the author baked the embeds CLIENT-SIDE, the route validated the bundle via
 * parseSnapshotBundle, then serialized it). Pass null for a text-only page or
 * when no embeds were baked, which stores NULL and the public render shows the
 * calm unavailable card for any embed it cannot resolve. The column is always
 * written (set to the value or NULL) so a re-publish never leaves a previous
 * bundle behind a newer body.
 */
export async function publishPage(
  labOwnerKey: string,
  path: string,
  snapshotsJson: string | null = null,
  hostedJson: string | null = null,
): Promise<LabSitePageRow | null> {
  await ensureLabSiteSchema();
  const p = normalizePagePath(path);
  const sql = getSql();
  const rows = (await sql`
    UPDATE lab_site_pages
    SET status = 'published',
        version = version + 1,
        snapshots_json = ${snapshotsJson},
        hosted_json = ${hostedJson},
        updated_at = now()
    WHERE lab_owner_key = ${labOwnerKey} AND path = ${p}
    RETURNING lab_owner_key, path, title, body_md, status, version, updated_at, snapshots_json, hosted_json, blocks_json
  `) as RawPageRow[];
  if (!rows[0]) return null;
  const page = rowToPage(rows[0]);
  // Part 1, per-site storage metering: register the published page's bytes to
  // the billing table. Fire-and-forget (meterNativePage swallows failures so
  // a DB blip cannot fail the publish or roll back the row). The metered bytes
  // are the UTF-8 length of the stored page representation (blocks_json or
  // body_md, plus snapshots_json when present). site_key = siteKeyForPath(path).
  void meterNativePage(
    labOwnerKey,
    p,
    rows[0].blocks_json ?? null,
    rows[0].body_md ?? "",
    snapshotsJson,
  );
  return page;
}

// ---------------------------------------------------------------------------
// blocks_json helpers (P1 companion builder)
// ---------------------------------------------------------------------------

/**
 * Fetches the raw blocks_json text for a page, or null when none is stored.
 * A null return means the page is a markdown page (body_md is the canonical
 * body). Callers parse the text via parseLabSiteBlocks in lab-site-blocks.ts.
 */
export async function getPageBlocksJson(
  labOwnerKey: string,
  path: string,
): Promise<string | null> {
  if (!labOwnerKey) return null;
  const p = normalizePagePath(path);
  const sql = getSql();
  const rows = (await sql`
    SELECT blocks_json
    FROM lab_site_pages
    WHERE lab_owner_key = ${labOwnerKey} AND path = ${p}
    LIMIT 1
  `) as Array<{ blocks_json?: string | null }>;
  return rows[0]?.blocks_json ?? null;
}

/**
 * Writes (or clears) the blocks_json for a page. When blocksJson is non-null,
 * the page becomes a BLOCKS page: body_md is set to '' and status resets to
 * draft so the old markdown body never resurfaces on the public page. When
 * blocksJson is null, the column is cleared (reverting to a markdown page is
 * handled by upsertPage, not here). The page must already exist via upsertPage
 * (or a prior setPageBlocksJson call with a non-null value that created the
 * row). Returns true when the row was found and updated.
 *
 * NOTE: this does NOT create the row if absent. The P2 editor must first call
 * upsertPage (markdown path) or a future P2 upsertBlocksPage helper to ensure
 * the row exists before calling this.
 */
export async function setPageBlocksJson(
  labOwnerKey: string,
  path: string,
  blocksJson: string | null,
): Promise<boolean> {
  if (!labOwnerKey) return false;
  await ensureLabSiteSchema();
  const p = normalizePagePath(path);
  const sql = getSql();
  const rows = (await sql`
    UPDATE lab_site_pages
    SET blocks_json = ${blocksJson},
        body_md = CASE WHEN ${blocksJson} IS NOT NULL THEN '' ELSE body_md END,
        status = 'draft',
        snapshots_json = NULL,
        hosted_json = NULL,
        updated_at = now()
    WHERE lab_owner_key = ${labOwnerKey} AND path = ${p}
    RETURNING lab_owner_key
  `) as Array<{ lab_owner_key: string }>;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Slug rename (Phase PI-slug-rename)
// ---------------------------------------------------------------------------

/** Result type for rebindLabSlug. */
export type RebindLabSlugResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "invalid" | "not-owner" | "not-found" };

/**
 * Renames a lab's public slug from oldSlug to newSlug with ZERO data loss.
 *
 * Write order is chosen so that a partial failure never frees the old slug or
 * leaves the lab_sites row orphaned:
 *   1. Reserve newSlug in slug_registry (atomic PK insert). If taken, bail now.
 *   2. Verify the lab_sites row exists and belongs to ownerKey.
 *   3. Repoint lab_sites.lab_slug from oldSlug to newSlug.
 *   4. Mark the old slug_registry row with redirect_to = newSlug (never deleted,
 *      citation safety: existing paper links, shared URLs, and external bookmarks
 *      continue to resolve via the permanent redirect).
 *
 * Step 1 claims newSlug before step 3 changes the lab_sites row, so a crash
 * between steps 1 and 3 leaves the lab still reachable at oldSlug (the new slug
 * is reserved but the lab_sites row still points at old). Step 4 failing
 * (network blip) is the worst case: newSlug is live but oldSlug has no redirect
 * yet. That is still SAFE (the lab serves correctly at newSlug) and the redirect
 * can be applied via a follow-up migration; it is not a data-loss scenario.
 *
 * labId is used as the ref on the newSlug registry row (mirrors the convention
 * in the original create-site flow where ownerKey is used as both owner_key and
 * ref). Pass ownerKey when labId equals ownerKey (they are the same in the
 * billing model: a lab is keyed by its billing owner key).
 */
export async function rebindLabSlug(args: {
  ownerKey: string;
  oldSlug: string;
  newSlug: string;
}): Promise<RebindLabSlugResult> {
  const { ownerKey, oldSlug, newSlug } = args;

  // Step 1: reserve the new slug. reserveSlug handles ensureSlugRegistrySchema
  // and validates the slug shape via validateReserve before the INSERT.
  const reserved = await reserveSlug(newSlug, "lab", ownerKey, ownerKey);
  if (!reserved.ok) {
    if (reserved.reason === "taken") return { ok: false, reason: "taken" };
    // reason === "invalid" covers malformed slug (too short, reserved word, etc.)
    return { ok: false, reason: "invalid" };
  }

  // Step 2 + 3: verify ownership and repoint lab_sites in a single UPDATE that
  // only matches the row belonging to this owner (avoids a separate SELECT that
  // could race). The RETURNING clause confirms the row existed and matched.
  await ensureLabSiteSchema();
  const sql = getSql();
  const repointed = (await sql`
    UPDATE lab_sites
    SET lab_slug = ${newSlug}
    WHERE lab_owner_key = ${ownerKey} AND lab_slug = ${oldSlug}
    RETURNING lab_owner_key
  `) as Array<{ lab_owner_key: string }>;

  if (repointed.length === 0) {
    // Either the lab has no site, or the oldSlug does not match this owner.
    // Distinguish the two cases so the route can return 403 vs 404.
    const site = (await sql`
      SELECT lab_owner_key FROM lab_sites WHERE lab_owner_key = ${ownerKey} LIMIT 1
    `) as Array<{ lab_owner_key: string }>;
    return site.length > 0
      ? { ok: false, reason: "not-owner" }
      : { ok: false, reason: "not-found" };
  }

  // Step 4: mark the old slug as a permanent redirect. The old row stays forever
  // so citations and external links continue to resolve. We do not free the slug
  // for reuse (another lab claiming "oldslug" would break those redirects).
  await ensureSlugRegistrySchema();
  await sql`
    UPDATE slug_registry
    SET redirect_to = ${newSlug}
    WHERE slug = ${oldSlug}
  `;

  return { ok: true };
}
