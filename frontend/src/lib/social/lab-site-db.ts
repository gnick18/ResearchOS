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

import { normalizePagePath, type PageStatus } from "./lab-site";

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
}

function rowToSite(r: {
  lab_owner_key: string;
  lab_slug: string;
  created_at: string;
}): LabSiteRow {
  return {
    labOwnerKey: r.lab_owner_key,
    labSlug: r.lab_slug,
    createdAt: r.created_at,
  };
}

/** The raw shape of a lab_site_pages SELECT, including the Phase 3b column. */
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
  };
}

// ---------------------------------------------------------------------------
// Site lookups
// ---------------------------------------------------------------------------

/** Fetches the site for a lab owner-key, or null if none exists yet. */
export async function getSiteByOwner(
  labOwnerKey: string,
): Promise<LabSiteRow | null> {
  if (!labOwnerKey) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, lab_slug, created_at
    FROM lab_sites
    WHERE lab_owner_key = ${labOwnerKey}
    LIMIT 1
  `) as Array<{ lab_owner_key: string; lab_slug: string; created_at: string }>;
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
    SELECT lab_owner_key, lab_slug, created_at
    FROM lab_sites
    WHERE lab_slug = ${labSlug}
    LIMIT 1
  `) as Array<{ lab_owner_key: string; lab_slug: string; created_at: string }>;
  return rows[0] ? rowToSite(rows[0]) : null;
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
    SELECT lab_owner_key, path, title, body_md, status, version, updated_at, snapshots_json, hosted_json
    FROM lab_site_pages
    WHERE lab_owner_key = ${labOwnerKey} AND path = ${p}
    LIMIT 1
  `) as RawPageRow[];
  return rows[0] ? rowToPage(rows[0]) : null;
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
    RETURNING lab_owner_key, path, title, body_md, status, version, updated_at, snapshots_json, hosted_json
  `) as RawPageRow[];
  return rows[0] ? rowToPage(rows[0]) : null;
}
