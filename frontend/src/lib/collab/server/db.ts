// Collab server DB helpers -- storage-measurement layer.
//
// The Neon-backed collab persistence tables (collab_docs, collab_doc_updates,
// collab_doc_members) and all write/read helpers have been removed now that the
// Cloudflare Durable Object owns collab persistence. What remains here are the
// read-only storage-measurement functions consumed by the billing routes and the
// /admin capacity gauge. They measure logical byte usage via octet_length against
// the same Neon tables (if they exist) and fall back gracefully when the tables
// are absent or empty.
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
// Storage-measurement helpers (used by billing routes and /admin gauge)
// ---------------------------------------------------------------------------

/**
 * The per-owner storage ceiling, in bytes, for the owner identified by the
 * peppered email hash stored in collab_docs.owner_email_hash.
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
 * Total logical byte usage across every doc a given owner owns, snapshots plus
 * outstanding update logs. Same octet_length basis as the historical per-doc
 * gate so the per-owner gate and the per-doc gate measure the same way.
 */
export async function getOwnerUsage(ownerHash: string): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      (SELECT COALESCE(SUM(octet_length(latest_snapshot)), 0)
         FROM collab_docs
        WHERE owner_email_hash = ${ownerHash})
      +
      (SELECT COALESCE(SUM(octet_length(u.update_bytes)), 0)
         FROM collab_doc_updates u
         JOIN collab_docs d ON d.doc_id = u.doc_id
        WHERE d.owner_email_hash = ${ownerHash}) AS owner_bytes
  `) as Array<{ owner_bytes: string | number }>;
  return Number(rows[0]?.owner_bytes ?? 0);
}

/**
 * On-disk footprint of the two collab content tables in bytes, for the operator
 * dashboard. Uses pg_total_relation_size (table + indexes + TOAST) because that
 * is what actually counts against the Neon 0.5 GB tier, unlike the octet_length
 * basis the budget gate uses. The two numbers differ (disk is compressed and
 * carries overhead), which is expected, the gauge reports true cost and the gate
 * enforces a deterministic logical size.
 */
export async function getCollabStorageBytes(): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      pg_total_relation_size('collab_docs')
      + pg_total_relation_size('collab_doc_updates') AS bytes
  `) as Array<{ bytes: string | number }>;
  return Number(rows[0]?.bytes ?? 0);
}
