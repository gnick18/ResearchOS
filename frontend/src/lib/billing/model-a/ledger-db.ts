// Model A billing, Neon schema for the cloud usage ledger (Step 3).
//
// The cloud counterpart of ai-ledger-db.ts, same idempotent style. Two tables:
//   cloud_balance: one row per PAYER (a solo owner, or a lab/dept billing owner),
//     the running accrued cents owed and the card on file for off-session charges
//     (Step 4). We SHOW a monthly price but BILL off this accrued balance to dodge
//     Stripe's $0.30/charge, running the card only when it crosses ~$5 (or at
//     cancellation).
//   cloud_usage_ledger: an append-only journal. An 'accrual' row per payer per
//     period records the marked-up Model-A charge (with the base/usage/storage/
//     hosted breakdown), a 'charge' row records a card run (negative). idem_key is
//     the idempotency key: 'accrue:<owner>:<period>' for an accrual (a re-run of a
//     month accrues once) and the Stripe event id for a charge.
//
// The Neon driver is a lazy singleton from DATABASE_URL, matching db.ts / ops.ts /
// ai-ledger-db.ts. Schema creation is idempotent and cheap to call per operation.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** The Neon tagged-template the ledger logic runs against. Same shape the rest of
 *  billing uses, so the ledger can be unit-tested with a mock of this type. */
export type Sql = NeonQueryFunction<false, false>;

let sqlSingleton: Sql | null = null;

export function getSql(): Sql {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Cloud billing cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

let schemaEnsured = false;

/** Creates the cloud ledger tables if they do not exist. Idempotent. */
export async function ensureCloudLedgerSchema(sql: Sql = getSql()): Promise<void> {
  if (schemaEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS cloud_balance (
      owner_key text primary key,
      accrued_cents bigint not null default 0,
      last_charged_at timestamptz,
      stripe_customer_id text,
      stripe_payment_method_id text,
      monthly_cap_cents bigint,
      updated_at timestamptz default now()
    )
  `;
  // Lab free-trial (Grant 2026-06-19). A new lab head starts with no card and a
  // 90-day trial; this stamps when the trial ends. Additive and nullable, so
  // every existing row reads as "no trial" (trial_ends_at IS NULL) and the engine
  // behaves exactly as before for them. ADD COLUMN IF NOT EXISTS is idempotent.
  await sql`
    ALTER TABLE cloud_balance ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz
  `;
  // Dispute pause (Grant 2026-06-19). When a customer files a card dispute we
  // PAUSE the account (stop new accrual) so a disputed user cannot keep running up
  // uncharged usage while the dispute is open. This stamps when the dispute opened;
  // a dispute resolved in our favor (won) clears it back to null, a lost dispute
  // leaves it set (the money is gone, do not silently un-pause). Additive and
  // nullable, so every existing row reads as "not disputed" (disputed_at IS NULL)
  // and the engine behaves exactly as before. ADD COLUMN IF NOT EXISTS is
  // idempotent.
  await sql`
    ALTER TABLE cloud_balance ADD COLUMN IF NOT EXISTS disputed_at timestamptz
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS cloud_usage_ledger (
      id bigserial primary key,
      owner_key text not null,
      kind text not null,
      cents_delta bigint not null,
      period text,
      base_cents bigint,
      usage_cents bigint,
      storage_cents bigint,
      hosted_cents bigint,
      idem_key text,
      created_at timestamptz default now()
    )
  `;
  // A re-run of a month's accrual, or a redelivered Stripe charge event, must take
  // effect once. A partial unique index on the non-null idem keys enforces it at
  // the database level, belt and braces with the application-level check.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS cloud_usage_ledger_idem_key_uniq
      ON cloud_usage_ledger (idem_key)
      WHERE idem_key IS NOT NULL
  `;
  schemaEnsured = true;
}

/** Test-only, resets the cached schema flag so a fresh mock sql is re-initialized. */
export function __resetCloudSchemaCacheForTests(): void {
  schemaEnsured = false;
}

/** One row from cloud_usage_ledger as returned to the billing UI. */
export interface LedgerEntry {
  /** 'accrual' | 'charge' | 'credit' */
  kind: string;
  /** Signed cents: positive for accruals/credits, negative for card runs. */
  centsDelta: number;
  /** Billing period label (e.g. '2026-06') for accruals; reason string for credits;
   *  null for raw card-charge rows. */
  period: string | null;
  /** The running accrued balance at this row (window SUM over id). */
  balanceCents: number;
  /** ISO timestamp. */
  createdAt: string;
}

/**
 * Recent ledger entries for a billing owner, newest first, with a per-row
 * running balance attached via a window SUM. Used by the billing history table
 * in Settings. Additive read, never writes.
 */
export async function listLedgerEntries(
  ownerKey: string,
  limit = 24,
  sql: Sql = getSql(),
): Promise<LedgerEntry[]> {
  await ensureCloudLedgerSchema(sql);
  // Compute running balance forward (oldest row first) in a CTE so each row
  // carries "balance after this entry", then flip to newest-first for the UI.
  const rows = (await sql`
    WITH ordered AS (
      SELECT
        kind,
        cents_delta,
        period,
        created_at,
        SUM(cents_delta) OVER (
          PARTITION BY owner_key ORDER BY id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_balance
      FROM cloud_usage_ledger
      WHERE owner_key = ${ownerKey}
      ORDER BY id
    )
    SELECT kind, cents_delta, period, created_at, running_balance
    FROM ordered
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as Array<{
    kind: string;
    cents_delta: number;
    period: string | null;
    created_at: string;
    running_balance: number;
  }>;
  return rows.map((r) => ({
    kind: r.kind,
    centsDelta: Number(r.cents_delta),
    period: r.period,
    balanceCents: Number(r.running_balance),
    createdAt: r.created_at,
  }));
}
