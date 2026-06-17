// Lab BYO ("bring your own") static-site manifest, Neon persistence (lab-domains
// BYO Slice 1, social lane).
//
// The data layer for an uploaded static site. A lab (referenced ONLY by its
// billing owner-key hash) owns AT MOST ONE BYO site, stored as a single row: the
// validated file-list manifest (JSON text), the index document, and the total
// bytes. The file BYTES live in R2 (lab-site-asset-store.ts); this table is just
// the metadata index the serve route consults to answer "does this lab have a BYO
// file at this path".
//
// Conventions mirror lib/social/lab-site-db.ts exactly: a lazily-constructed Neon
// singleton from DATABASE_URL, an idempotent CREATE TABLE IF NOT EXISTS callable on
// every route entry, and parameterized tagged-template queries. This module does
// NOT import lib/sharing/identity/**, lib/sharing/directory/** schema, or
// lib/billing/** write paths. A lab is referenced only by its lab_owner_key passed
// in as a plain string. The pure manifest validation lives in lab-byo.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { parseByoManifest, type ByoSiteManifest } from "./lab-byo";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The lab-byo store cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** A lab_byo_sites row as stored, with the manifest parsed back into a typed
 *  ByoSiteManifest. One row per lab. */
export interface LabByoSiteRow {
  labOwnerKey: string;
  manifest: ByoSiteManifest;
  totalBytes: number;
  updatedAt: string;
}

/**
 * Creates the lab_byo_sites table if it does not already exist. Idempotent, so
 * every route can call it on entry without a migration step. Keyed by the billing
 * owner-key hash (one BYO site per lab). manifest_json is the validated, serialized
 * ByoSiteManifest (file list + index); total_bytes mirrors the manifest total and
 * the value reported to billing, kept as a column for a cheap sum if ever needed.
 */
export async function ensureLabByoSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_byo_sites (
      lab_owner_key text primary key,
      manifest_json text not null,
      total_bytes   bigint not null default 0,
      updated_at    timestamptz default now()
    )
  `;
}

function rowToByoSite(r: {
  lab_owner_key: string;
  manifest_json: string;
  total_bytes: string | number;
  updated_at: string;
}): LabByoSiteRow {
  return {
    labOwnerKey: r.lab_owner_key,
    manifest: parseByoManifest(r.manifest_json),
    totalBytes: Number(r.total_bytes),
    updatedAt: r.updated_at,
  };
}

/** Fetches the BYO site for a lab owner-key, or null if none exists yet. */
export async function getByoSiteByOwner(
  labOwnerKey: string,
): Promise<LabByoSiteRow | null> {
  if (!labOwnerKey) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, manifest_json, total_bytes, updated_at
    FROM lab_byo_sites
    WHERE lab_owner_key = ${labOwnerKey}
    LIMIT 1
  `) as Array<{
    lab_owner_key: string;
    manifest_json: string;
    total_bytes: string | number;
    updated_at: string;
  }>;
  return rows[0] ? rowToByoSite(rows[0]) : null;
}

/**
 * Upsert the BYO site manifest for a lab (idempotent on lab_owner_key). The
 * manifest is the already-validated ByoSiteManifest; manifestJson is its serialized
 * form (callers serialize via serializeByoManifest). totalBytes mirrors the
 * manifest total. A re-upload replaces the whole row in place.
 */
export async function upsertByoSite(input: {
  labOwnerKey: string;
  manifestJson: string;
  totalBytes: number;
}): Promise<LabByoSiteRow | null> {
  await ensureLabByoSchema();
  const sql = getSql();
  await sql`
    INSERT INTO lab_byo_sites (lab_owner_key, manifest_json, total_bytes, updated_at)
    VALUES (${input.labOwnerKey}, ${input.manifestJson}, ${Math.max(0, Math.round(input.totalBytes))}, now())
    ON CONFLICT (lab_owner_key) DO UPDATE SET
      manifest_json = EXCLUDED.manifest_json,
      total_bytes   = EXCLUDED.total_bytes,
      updated_at    = now()
  `;
  return getByoSiteByOwner(input.labOwnerKey);
}

/**
 * Enumerate EVERY lab that has a BYO site (one row per lab). Used by the Phase 4b
 * lapse-reclaim GC to discover which labs own a BYO site so it can reclaim the
 * R2 bytes + billing asset of any whose subscription lapsed past the grace window.
 * Mirrors lib/social/lab-site-db.ts listAllSiteHostedManifests: a light, bounded
 * scan (one row per lab, metadata only, no file bytes) suitable for a daily cron.
 *
 * BOUNDARY: reads only the social lane's own lab_byo_sites table. It does NOT join
 * Billing; the caller cross-references each lab_owner_key against getLabLapse. A lab
 * is referenced only by its lab_owner_key. The manifest is parsed back into a typed
 * ByoSiteManifest, identical to the per-owner read.
 */
export async function listAllByoSites(): Promise<LabByoSiteRow[]> {
  await ensureLabByoSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, manifest_json, total_bytes, updated_at
    FROM lab_byo_sites
    ORDER BY lab_owner_key
  `) as Array<{
    lab_owner_key: string;
    manifest_json: string;
    total_bytes: string | number;
    updated_at: string;
  }>;
  return rows.map(rowToByoSite);
}

/** Deletes a lab's BYO site row (best effort). Used when a lab removes its BYO
 *  site; the R2 files are removed separately via deleteByoSite. */
export async function deleteByoSiteRow(labOwnerKey: string): Promise<void> {
  if (!labOwnerKey) return;
  await ensureLabByoSchema();
  const sql = getSql();
  await sql`DELETE FROM lab_byo_sites WHERE lab_owner_key = ${labOwnerKey}`;
}

// ---------------------------------------------------------------------------
// GitHub source connection (lab-domains BYO GitHub-connect Slice A)
//
// A lab may source its BYO site from a PUBLIC GitHub repo instead of a manual zip
// upload. The connection (repo owner/name, ref, optional subdir) is recorded here,
// one per lab, so a "sync now" action can re-pull the recorded repo. The pulled
// FILES still land in lab_byo_sites / R2 via the normal BYO path; this table only
// remembers WHERE to pull from. The owner/repo/ref values are charset-validated in
// lab-byo-github.ts BEFORE they are recorded, so this store holds only safe values.
// ---------------------------------------------------------------------------

/** A recorded GitHub connection for one lab (one connection per lab). */
export interface LabByoGithubRow {
  labOwnerKey: string;
  owner: string;
  repo: string;
  ref: string;
  /** "" when the repo root is the site root. */
  subdir: string;
  /** The resolved commit sha of the last successful sync, or null. */
  lastSyncedSha: string | null;
  /** ISO timestamp of the last successful sync, or null. */
  lastSyncedAt: string | null;
  updatedAt: string;
}

/** Creates the lab_byo_github table if absent. Idempotent (callable per request).
 *  Keyed by lab_owner_key (one connection per lab). */
export async function ensureLabByoGithubSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_byo_github (
      lab_owner_key   text primary key,
      owner           text not null,
      repo            text not null,
      ref             text not null,
      subdir          text not null default '',
      last_synced_sha text,
      last_synced_at  timestamptz,
      updated_at      timestamptz default now()
    )
  `;
}

function rowToGithub(r: {
  lab_owner_key: string;
  owner: string;
  repo: string;
  ref: string;
  subdir: string | null;
  last_synced_sha: string | null;
  last_synced_at: string | null;
  updated_at: string;
}): LabByoGithubRow {
  return {
    labOwnerKey: r.lab_owner_key,
    owner: r.owner,
    repo: r.repo,
    ref: r.ref,
    subdir: r.subdir ?? "",
    lastSyncedSha: r.last_synced_sha ?? null,
    lastSyncedAt: r.last_synced_at ?? null,
    updatedAt: r.updated_at,
  };
}

/** Fetches the recorded GitHub connection for a lab, or null when none. */
export async function getByoGithubByOwner(
  labOwnerKey: string,
): Promise<LabByoGithubRow | null> {
  if (!labOwnerKey) return null;
  await ensureLabByoGithubSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT lab_owner_key, owner, repo, ref, subdir, last_synced_sha, last_synced_at, updated_at
    FROM lab_byo_github
    WHERE lab_owner_key = ${labOwnerKey}
    LIMIT 1
  `) as Array<{
    lab_owner_key: string;
    owner: string;
    repo: string;
    ref: string;
    subdir: string | null;
    last_synced_sha: string | null;
    last_synced_at: string | null;
    updated_at: string;
  }>;
  return rows[0] ? rowToGithub(rows[0]) : null;
}

/** Upsert a lab's GitHub connection (idempotent on lab_owner_key). The values are
 *  already charset-validated by the caller (parseGithubConnection). Re-connecting
 *  replaces the row and resets the last-synced markers. */
export async function upsertByoGithub(input: {
  labOwnerKey: string;
  owner: string;
  repo: string;
  ref: string;
  subdir: string;
}): Promise<LabByoGithubRow | null> {
  await ensureLabByoGithubSchema();
  const sql = getSql();
  await sql`
    INSERT INTO lab_byo_github (lab_owner_key, owner, repo, ref, subdir, updated_at)
    VALUES (${input.labOwnerKey}, ${input.owner}, ${input.repo}, ${input.ref}, ${input.subdir}, now())
    ON CONFLICT (lab_owner_key) DO UPDATE SET
      owner      = EXCLUDED.owner,
      repo       = EXCLUDED.repo,
      ref        = EXCLUDED.ref,
      subdir     = EXCLUDED.subdir,
      updated_at = now()
  `;
  return getByoGithubByOwner(input.labOwnerKey);
}

/** Record a successful sync's resolved sha + timestamp for a lab's connection
 *  (best effort; a missing connection is a no-op). */
export async function recordByoGithubSync(input: {
  labOwnerKey: string;
  resolvedSha: string | null;
}): Promise<void> {
  if (!input.labOwnerKey) return;
  await ensureLabByoGithubSchema();
  const sql = getSql();
  await sql`
    UPDATE lab_byo_github
    SET last_synced_sha = ${input.resolvedSha}, last_synced_at = now()
    WHERE lab_owner_key = ${input.labOwnerKey}
  `;
}

/** Deletes a lab's GitHub connection row (best effort). The pulled files are
 *  removed separately via deleteByoSite when the site itself is removed. */
export async function deleteByoGithubRow(labOwnerKey: string): Promise<void> {
  if (!labOwnerKey) return;
  await ensureLabByoGithubSchema();
  const sql = getSql();
  await sql`DELETE FROM lab_byo_github WHERE lab_owner_key = ${labOwnerKey}`;
}
