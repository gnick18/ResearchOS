// Collab server DB helpers -- storage-measurement layer.
//
// The Neon-backed collab persistence tables (collab_docs, collab_doc_updates,
// collab_doc_members) and all write/read helpers have been removed now that the
// Cloudflare Durable Object owns collab persistence. What remains here are the
// storage-measurement functions consumed by the billing routes and the /admin
// capacity gauge. The canonical per-owner tally is now in collab_doc_sizes,
// populated by the DO backup alarm via POST /api/collab/doc-size.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import {
  MAX_OWNER_BYTES,
} from "@/lib/collab/server/limits";
import { isBillingEnabled } from "@/lib/billing/config";
import { quotaBytesForOwner } from "@/lib/billing/db";

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily constructs the Neon query function from DATABASE_URL. Throws a clear
 * error if the connection string is missing so a misconfigured deployment fails
 * at request time rather than producing a confusing driver error.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The collab backend cannot reach Neon without it.",
    );
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/**
 * Replaces the singleton with a test double. Only called from test files.
 * Passing null restores the lazy-construct behavior.
 */
export function _testSetSql(
  fake: NeonQueryFunction<false, false> | null,
): void {
  sqlSingleton = fake;
}

// ---------------------------------------------------------------------------
// collab_doc_sizes table (DO-era per-owner tally)
// ---------------------------------------------------------------------------

/**
 * Creates the collab_doc_sizes table and its owner_hash index if they do not
 * already exist. Idempotent, safe to call on every route entry. The DO backup
 * alarm populates this table via POST /api/collab/doc-size; the billing routes
 * read from it via getOwnerUsage.
 *
 * doc_id is the stable session id the DO is addressed by (idFromName key).
 * owner_hash is the peppered email hash from lib/billing/owner.ts, matching the
 * key the billing layer uses everywhere.
 * bytes is the raw byteLength of the latest Loro snapshot from the DO alarm.
 */
export async function ensureDocSizesSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS collab_doc_sizes (
      doc_id     TEXT PRIMARY KEY,
      owner_hash TEXT NOT NULL,
      bytes      BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_collab_doc_sizes_owner_hash
      ON collab_doc_sizes (owner_hash)
  `;
}

/**
 * Inserts or updates the size record for one doc. Called by the
 * /api/collab/doc-size route on each DO backup alarm tick. On conflict the
 * bytes and updated_at are overwritten; doc_id is stable.
 */
export async function upsertDocSize(params: {
  docId: string;
  ownerHash: string;
  bytes: number;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO collab_doc_sizes (doc_id, owner_hash, bytes, updated_at)
    VALUES (${params.docId}, ${params.ownerHash}, ${params.bytes}, now())
    ON CONFLICT (doc_id) DO UPDATE SET
      owner_hash = EXCLUDED.owner_hash,
      bytes      = EXCLUDED.bytes,
      updated_at = now()
  `;
}

// ---------------------------------------------------------------------------
// Storage-measurement helpers (used by billing routes and /admin gauge)
// ---------------------------------------------------------------------------

/**
 * The per-owner storage ceiling, in bytes, for the owner identified by the
 * peppered email hash stored in collab_doc_sizes.owner_hash.
 *
 * When billing is on, the quota is owned by the billing layer: the free
 * allowance plus whatever blocks the owner has purchased, so buying a block
 * actually lifts the wall. ownerHash is already the billing owner key (the same
 * peppered hash lib/billing/owner.ts derives, the value the directory and relay
 * key by too), so it is passed straight through with no re-derivation.
 *
 * When billing is off (the default, and all of pre-launch) there is nothing to
 * buy, so the ceiling falls back to the flat MAX_OWNER_BYTES fairness wall that
 * protects the shared Neon tier.
 */
export async function getOwnerQuotaBytes(ownerHash: string): Promise<number> {
  if (isBillingEnabled()) {
    return quotaBytesForOwner(ownerHash);
  }
  return MAX_OWNER_BYTES;
}

/**
 * Total bytes owned by the given owner, summed from the DO-populated
 * collab_doc_sizes table. This replaces the old octet_length scan of the
 * stale Neon collab_docs / collab_doc_updates tables; the DO backup alarm
 * keeps the sizes current.
 */
export async function getOwnerUsage(ownerHash: string): Promise<number> {
  const sql = getSql();
  await ensureDocSizesSchema();
  const rows = (await sql`
    SELECT COALESCE(SUM(bytes), 0) AS owner_bytes
    FROM collab_doc_sizes
    WHERE owner_hash = ${ownerHash}
  `) as Array<{ owner_bytes: string | number }>;
  return Number(rows[0]?.owner_bytes ?? 0);
}

/**
 * Total bytes in a billing owner's SHARED POOL = their own docs plus every
 * active member's docs (the tally stays keyed by the real doc owner, so the
 * membership sum happens here at read time). For a solo user the membership
 * subquery is empty, so the pool collapses to just their own usage. This is what
 * makes the free tier a per-lab shared resource rather than per-member. See
 * docs/proposals/LAB_SHARED_BILLING_POOL.md.
 *
 * Cross-table note: this references billing_lab_members (the billing module's
 * table) by a scalar subquery. Both live in the same Neon DB; the caller runs
 * ensureLabSchema() first so the table exists. Kept as one query (scalar params
 * only) to avoid passing an array parameter to the Neon HTTP driver.
 */
export async function getLabPoolUsage(billingOwnerKey: string): Promise<number> {
  const sql = getSql();
  await ensureDocSizesSchema();
  const rows = (await sql`
    SELECT COALESCE(SUM(bytes), 0) AS pool_bytes
    FROM collab_doc_sizes
    WHERE owner_hash = ${billingOwnerKey}
       OR owner_hash IN (
         SELECT member_owner_key FROM billing_lab_members
         WHERE lab_owner_key = ${billingOwnerKey} AND status = 'active'
       )
  `) as Array<{ pool_bytes: string | number }>;
  return Number(rows[0]?.pool_bytes ?? 0);
}

/**
 * On-disk footprint of the collab_doc_sizes table in bytes, for the operator
 * dashboard. Uses pg_total_relation_size (table + indexes + TOAST) so the
 * gauge reflects true Neon storage cost, not logical row bytes.
 */
export async function getCollabStorageBytes(): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT pg_total_relation_size('collab_doc_sizes') AS bytes
  `) as Array<{ bytes: string | number }>;
  return Number(rows[0]?.bytes ?? 0);
}
