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
