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
// collab_owner_writes table (per-owner monthly ACTIVITY tally)
// ---------------------------------------------------------------------------

/**
 * Per-owner monthly write counter, the activity analogue of collab_doc_sizes.
 * One row per (owner_hash, period), where period is a YYYY-MM month bucket
 * stamped by SERVER time (so the DO never needs a clock and month rollover is
 * authoritative on Vercel). The DO reports a write DELTA on each backup alarm
 * via POST /api/collab/activity; the owner-state route reads the pool sum.
 * Activity (collab writes / compute) is the real cost driver, so this is what an
 * over-allowance owner gets throttled against. Keyed by the REAL doc owner, like
 * collab_doc_sizes, so the lab pool is summed at read time.
 */
export async function ensureOwnerWritesSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS collab_owner_writes (
      owner_hash TEXT NOT NULL,
      period     TEXT NOT NULL,
      writes     BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_hash, period)
    )
  `;
}

/** Adds a write delta to an owner's counter for the given YYYY-MM period. */
export async function incrementOwnerWrites(
  ownerHash: string,
  delta: number,
  period: string,
): Promise<void> {
  if (delta <= 0) return;
  const sql = getSql();
  await sql`
    INSERT INTO collab_owner_writes (owner_hash, period, writes, updated_at)
    VALUES (${ownerHash}, ${period}, ${delta}, now())
    ON CONFLICT (owner_hash, period) DO UPDATE SET
      writes     = collab_owner_writes.writes + ${delta},
      updated_at = now()
  `;
}

/**
 * Total writes in a billing owner's SHARED POOL for one period = their own
 * writes plus every active member's writes (membership resolved in SQL at read
 * time, exactly like getLabPoolUsage). Solo users have no members, so the pool
 * is just their own. See docs/proposals/LAB_SHARED_BILLING_POOL.md.
 */
export async function getLabPoolWrites(
  billingOwnerKey: string,
  period: string,
): Promise<number> {
  const sql = getSql();
  await ensureOwnerWritesSchema();
  const rows = (await sql`
    SELECT COALESCE(SUM(writes), 0) AS pool_writes
    FROM collab_owner_writes
    WHERE period = ${period}
      AND (
        owner_hash = ${billingOwnerKey}
        OR owner_hash IN (
          SELECT member_owner_key FROM billing_lab_members
          WHERE lab_owner_key = ${billingOwnerKey} AND status = 'active'
        )
      )
  `) as Array<{ pool_writes: string | number }>;
  return Number(rows[0]?.pool_writes ?? 0);
}

/**
 * Average monthly write footprint per ACTIVE owner, computed from the most
 * recent period that has any data. This is the measured ground truth for the
 * pricing model's per-tier relayWritesM seed (the cost driver). Returns zeros
 * when no activity has been recorded yet (beta), so callers render a "no data"
 * state rather than a misleading 0.
 */
export interface ActivityBenchmark {
  /** YYYY-MM period the benchmark is computed over, or null if no data yet. */
  period: string | null;
  /** Owners with any writes in that period. */
  activeOwners: number;
  /** Mean writes per active owner that period (raw count, not millions). */
  avgWritesPerOwner: number;
}

export async function getActivityBenchmark(): Promise<ActivityBenchmark> {
  const sql = getSql();
  await ensureOwnerWritesSchema();
  const rows = (await sql`
    SELECT period,
           COUNT(*)::int AS active_owners,
           COALESCE(AVG(writes), 0) AS avg_writes
    FROM collab_owner_writes
    WHERE writes > 0
    GROUP BY period
    ORDER BY period DESC
    LIMIT 1
  `) as Array<{ period: string; active_owners: number; avg_writes: string | number }>;
  if (!rows.length) {
    return { period: null, activeOwners: 0, avgWritesPerOwner: 0 };
  }
  return {
    period: rows[0].period,
    activeOwners: Number(rows[0].active_owners),
    avgWritesPerOwner: Number(rows[0].avg_writes),
  };
}

// ---------------------------------------------------------------------------
// Lab hosted assets (companion-site data, social/lab-domains lane)
// ---------------------------------------------------------------------------
// A SEPARATE owner-keyed byte tally for PUBLISHED companion-site data assets
// (e.g. the parquet/json behind an interactive dataset viewer on R2). Kept
// distinct from collab_doc_sizes (the private cloud-workspace pool) on purpose:
// different billing (pass-through at 1.15x cost-recovery, see
// hostedAssetMonthlyCost in lib/pricing/service-model.ts), no quota wall (you
// pay for what you host), and a different lapse rule (GC 30 days after the lab's
// subscription lapses, UNLESS archived). The social lane reports bytes per asset
// and checks the archived flag before GC; billing reads the lab total to bill.

export async function ensureHostedAssetsSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS lab_hosted_assets (
      asset_id      TEXT NOT NULL PRIMARY KEY,
      lab_owner_key TEXT NOT NULL,
      bytes         BIGINT NOT NULL DEFAULT 0,
      archived      BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_lab_hosted_assets_owner
      ON lab_hosted_assets (lab_owner_key)
  `;
}

/** Upsert one published asset's byte size. The social lane calls this on publish
 *  and whenever the hosted dataset changes. */
export async function setHostedAssetBytes(
  assetId: string,
  labOwnerKey: string,
  bytes: number,
): Promise<void> {
  const sql = getSql();
  await ensureHostedAssetsSchema();
  await sql`
    INSERT INTO lab_hosted_assets (asset_id, lab_owner_key, bytes, updated_at)
    VALUES (${assetId}, ${labOwnerKey}, ${Math.max(0, Math.round(bytes))}, now())
    ON CONFLICT (asset_id) DO UPDATE SET
      lab_owner_key = EXCLUDED.lab_owner_key,
      bytes         = EXCLUDED.bytes,
      updated_at    = now()
  `;
}

/** Drop an asset's row (the social lane calls this on delete or after GC). */
export async function removeHostedAsset(assetId: string): Promise<void> {
  const sql = getSql();
  await ensureHostedAssetsSchema();
  await sql`DELETE FROM lab_hosted_assets WHERE asset_id = ${assetId}`;
}

/** Total hosted-asset bytes billed to a lab (assets keyed to its owner key). */
export async function getLabHostedBytes(labOwnerKey: string): Promise<number> {
  const sql = getSql();
  await ensureHostedAssetsSchema();
  const rows = (await sql`
    SELECT COALESCE(SUM(bytes), 0) AS b
    FROM lab_hosted_assets
    WHERE lab_owner_key = ${labOwnerKey}
  `) as Array<{ b: string | number }>;
  return Number(rows[0]?.b ?? 0);
}

/** Mark an asset permanently archived. The prepaid permanent-archive purchase
 *  sets this; the social lane checks it to SKIP the 30-day reclaim GC. */
export async function setHostedAssetArchived(
  assetId: string,
  archived: boolean,
): Promise<void> {
  const sql = getSql();
  await ensureHostedAssetsSchema();
  await sql`
    UPDATE lab_hosted_assets SET archived = ${archived}, updated_at = now()
    WHERE asset_id = ${assetId}
  `;
}

/** Whether an asset is permanently archived (GC must skip it). */
export async function isHostedAssetArchived(assetId: string): Promise<boolean> {
  const sql = getSql();
  await ensureHostedAssetsSchema();
  const rows = (await sql`
    SELECT archived FROM lab_hosted_assets WHERE asset_id = ${assetId} LIMIT 1
  `) as Array<{ archived: boolean }>;
  return rows[0]?.archived === true;
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
export async function getOwnerQuotaBytes(_ownerHash: string): Promise<number> {
  // Model A: the storage bound is the per-owner monthly $ cap (enforcement.ts)
  // plus the global cost breaker, NOT a byte ceiling. The flat fairness wall
  // (MAX_OWNER_BYTES) is the only hard byte limit that collab needs to enforce
  // server-side; per-owner spend enforcement happens in the owner-state route.
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
