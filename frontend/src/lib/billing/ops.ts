// Per-owner OPERATIONS tracking (Grant 2026-06-07).
//
// Storage metering misses the high-activity, low-storage user, who edits
// constantly (lots of rows written + requests + Durable Object duration) while
// net storage stays flat because compaction folds old update rows away. To make
// that cost visible we count, per owner, the WRITE operations and bytes written
// through the one collab growth point (appendUpdate). /admin turns these into an
// estimated cost-per-owner. This is tracking only, it never charges the user.
//
// One table.
//   billing_ops_samples: a daily per-owner counter of writes + bytes written, so
//     a month's activity is just a sum over the window (same shape as the storage
//     usage samples, but cumulative counts rather than a point-in-time gauge).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Ops tracking cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

let schemaEnsured = false;

export async function ensureOpsSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS billing_ops_samples (
      owner_key   text not null,
      sampled_on  date not null,
      writes      bigint not null default 0,
      written_bytes bigint not null default 0,
      primary key (owner_key, sampled_on)
    )
  `;
  schemaEnsured = true;
}

/**
 * Records one write operation for an owner (today's bucket), adding the bytes
 * written. Upsert-increments so many writes a day collapse into one row. Best
 * effort by the caller: a tracking failure must never block the actual write.
 */
export async function recordWriteOp(
  ownerKey: string,
  bytes: number,
): Promise<void> {
  const sql = getSql();
  // Create the table the first time this process records anything, so the hot
  // write path needs no separate migration step. After that it is a no-op.
  if (!schemaEnsured) await ensureOpsSchema();
  const b = Math.max(0, Math.floor(bytes));
  await sql`
    INSERT INTO billing_ops_samples (owner_key, sampled_on, writes, written_bytes)
    VALUES (${ownerKey}, current_date, 1, ${b})
    ON CONFLICT (owner_key, sampled_on) DO UPDATE SET
      writes = billing_ops_samples.writes + 1,
      written_bytes = billing_ops_samples.written_bytes + ${b}
  `;
}

export interface OwnerOps {
  writes: number;
  writtenBytes: number;
}

/** An owner's total writes + bytes written since a YYYY-MM-DD date. */
export async function opsSince(
  ownerKey: string,
  sinceISODate: string,
): Promise<OwnerOps> {
  const sql = getSql();
  const rows = (await sql`
    SELECT COALESCE(SUM(writes), 0) AS writes,
           COALESCE(SUM(written_bytes), 0) AS written_bytes
    FROM billing_ops_samples
    WHERE owner_key = ${ownerKey} AND sampled_on >= ${sinceISODate}
  `) as Array<{ writes: string | number; written_bytes: string | number }>;
  return {
    writes: Number(rows[0]?.writes ?? 0),
    writtenBytes: Number(rows[0]?.written_bytes ?? 0),
  };
}

export interface OwnerOpsRow extends OwnerOps {
  ownerKey: string;
}

/**
 * The owners with the most write operations since a date, for the /admin
 * cost-per-owner view. Capped so the operator sees the heaviest few.
 */
export async function topOwnersByWrites(
  sinceISODate: string,
  limit = 20,
): Promise<OwnerOpsRow[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key,
           SUM(writes) AS writes,
           SUM(written_bytes) AS written_bytes
    FROM billing_ops_samples
    WHERE sampled_on >= ${sinceISODate}
    GROUP BY owner_key
    ORDER BY SUM(writes) DESC
    LIMIT ${limit}
  `) as Array<{
    owner_key: string;
    writes: string | number;
    written_bytes: string | number;
  }>;
  return rows.map((r) => ({
    ownerKey: r.owner_key,
    writes: Number(r.writes),
    writtenBytes: Number(r.written_bytes),
  }));
}

/** Drops ops samples older than a date, after a period is rolled up. */
export async function pruneOpsSamples(beforeISODate: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM billing_ops_samples WHERE sampled_on < ${beforeISODate}`;
}
