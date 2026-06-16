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

function rowToPage(r: {
  lab_owner_key: string;
  path: string;
  title: string;
  body_md: string;
  status: string;
  version: string | number;
  updated_at: string;
}): LabSitePageRow {
  return {
    labOwnerKey: r.lab_owner_key,
    path: r.path,
    title: r.title,
    bodyMd: r.body_md,
    status: r.status === "published" ? "published" : "draft",
    version: Number(r.version),
    updatedAt: r.updated_at,
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
    SELECT lab_owner_key, path, title, body_md, status, version, updated_at
    FROM lab_site_pages
    WHERE lab_owner_key = ${labOwnerKey} AND path = ${p}
    LIMIT 1
  `) as Array<{
    lab_owner_key: string;
    path: string;
    title: string;
    body_md: string;
    status: string;
    version: string | number;
    updated_at: string;
  }>;
  return rows[0] ? rowToPage(rows[0]) : null;
}

/** Lists all pages for a lab (any status), newest-updated first. */
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
  `) as Array<{
    lab_owner_key: string;
    path: string;
    title: string;
    body_md: string;
    status: string;
    version: string | number;
    updated_at: string;
  }>;
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
  await sql`
    INSERT INTO lab_site_pages (lab_owner_key, path, title, body_md, status, updated_at)
    VALUES (${input.labOwnerKey}, ${p}, ${input.title}, ${input.bodyMd}, 'draft', now())
    ON CONFLICT (lab_owner_key, path) DO UPDATE SET
      title = EXCLUDED.title,
      body_md = EXCLUDED.body_md,
      status = 'draft',
      updated_at = now()
  `;
  return getPage(input.labOwnerKey, p);
}

/**
 * Publishes a page: flips status to published and increments version. Returns
 * the updated row, or null if the page does not exist (publish only acts on an
 * already-created draft). The page must be created via upsertPage first.
 */
export async function publishPage(
  labOwnerKey: string,
  path: string,
): Promise<LabSitePageRow | null> {
  await ensureLabSiteSchema();
  const p = normalizePagePath(path);
  const sql = getSql();
  const rows = (await sql`
    UPDATE lab_site_pages
    SET status = 'published', version = version + 1, updated_at = now()
    WHERE lab_owner_key = ${labOwnerKey} AND path = ${p}
    RETURNING lab_owner_key, path, title, body_md, status, version, updated_at
  `) as Array<{
    lab_owner_key: string;
    path: string;
    title: string;
    body_md: string;
    status: string;
    version: string | number;
    updated_at: string;
  }>;
  return rows[0] ? rowToPage(rows[0]) : null;
}
