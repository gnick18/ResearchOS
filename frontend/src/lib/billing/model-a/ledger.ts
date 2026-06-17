// Model A billing, cloud usage ledger logic (Step 3).
//
// The accrual side of the engine. The roll-up (Step 3 cron) computes a payer's
// marked-up charge for a closed period via periodCharge() and calls
// accruePeriodCharge() to add it to the running balance, idempotently per period.
// The charge job (Step 4) reads the balance, runs the card off-session when it
// crosses the threshold, and calls recordCharge() to draw it down.
//
// Each function takes an optional sql seam (defaulting to the lazy Neon singleton)
// so the logic is unit-tested with a mock, the same as ai-ledger.ts.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  ensureCloudLedgerSchema,
  getSql,
  type Sql,
} from "./ledger-db";
import type { PeriodCharge } from "./pricing";

/** The idempotency key for a payer's accrual in one period. Re-running a month
 *  (a retried cron, a backfill) accrues exactly once. */
export function accrualIdemKey(ownerKey: string, period: string): string {
  return `accrue:${ownerKey}:${period}`;
}

/**
 * Accrue one payer's marked-up charge for one period onto their running balance.
 * Idempotent on (ownerKey, period): a re-run inserts no second ledger row and
 * does not move the balance. Returns the balance after (unchanged on a re-run).
 */
export async function accruePeriodCharge(
  ownerKey: string,
  period: string,
  charge: PeriodCharge,
  sql: Sql = getSql(),
): Promise<number> {
  await ensureCloudLedgerSchema(sql);
  const idem = accrualIdemKey(ownerKey, period);

  // Step 1: append the accrual row, idempotent on the period idem key.
  const inserted = (await sql`
    INSERT INTO cloud_usage_ledger
      (owner_key, kind, cents_delta, period, base_cents, usage_cents, storage_cents, hosted_cents, idem_key)
    VALUES
      (${ownerKey}, 'accrual', ${charge.totalCents}, ${period}, ${charge.baseCents},
       ${charge.usageCents}, ${charge.storageCents}, ${charge.hostedCents}, ${idem})
    ON CONFLICT (idem_key) DO NOTHING
    RETURNING id
  `) as Array<{ id: number }>;

  // Step 2: only move the balance if the ledger row was actually inserted.
  if (inserted.length === 0) {
    return getCloudBalance(ownerKey, sql);
  }
  const rows = (await sql`
    INSERT INTO cloud_balance (owner_key, accrued_cents)
    VALUES (${ownerKey}, ${charge.totalCents})
    ON CONFLICT (owner_key) DO UPDATE
      SET accrued_cents = cloud_balance.accrued_cents + ${charge.totalCents},
          updated_at = now()
    RETURNING accrued_cents
  `) as Array<{ accrued_cents: number }>;
  return Number(rows[0]?.accrued_cents ?? charge.totalCents);
}

/**
 * Record a card run against a payer's balance, drawing it down by `cents`.
 * Idempotent on the Stripe event id (a redelivered payment event draws once).
 * Returns the balance after (unchanged on a redelivery).
 */
export async function recordCharge(
  ownerKey: string,
  cents: number,
  stripeEventId: string,
  sql: Sql = getSql(),
): Promise<number> {
  await ensureCloudLedgerSchema(sql);

  const inserted = (await sql`
    INSERT INTO cloud_usage_ledger
      (owner_key, kind, cents_delta, idem_key)
    VALUES
      (${ownerKey}, 'charge', ${-Math.abs(cents)}, ${stripeEventId})
    ON CONFLICT (idem_key) DO NOTHING
    RETURNING id
  `) as Array<{ id: number }>;

  if (inserted.length === 0) {
    return getCloudBalance(ownerKey, sql);
  }
  const rows = (await sql`
    INSERT INTO cloud_balance (owner_key, accrued_cents, last_charged_at)
    VALUES (${ownerKey}, ${-Math.abs(cents)}, now())
    ON CONFLICT (owner_key) DO UPDATE
      SET accrued_cents = cloud_balance.accrued_cents - ${Math.abs(cents)},
          last_charged_at = now(),
          updated_at = now()
    RETURNING accrued_cents
  `) as Array<{ accrued_cents: number }>;
  return Number(rows[0]?.accrued_cents ?? 0);
}

/** A payer's current accrued balance in cents (0 if no row yet). */
export async function getCloudBalance(
  ownerKey: string,
  sql: Sql = getSql(),
): Promise<number> {
  await ensureCloudLedgerSchema(sql);
  const rows = (await sql`
    SELECT accrued_cents FROM cloud_balance WHERE owner_key = ${ownerKey}
  `) as Array<{ accrued_cents: number }>;
  return Number(rows[0]?.accrued_cents ?? 0);
}

export interface CloudLedgerRow {
  kind: string;
  centsDelta: number;
  period: string | null;
  createdAt: string;
}

/** A payer's recent ledger rows, newest first, for the billing UI. */
export async function getCloudLedger(
  ownerKey: string,
  limit = 24,
  sql: Sql = getSql(),
): Promise<CloudLedgerRow[]> {
  await ensureCloudLedgerSchema(sql);
  const rows = (await sql`
    SELECT kind, cents_delta, period, created_at
    FROM cloud_usage_ledger
    WHERE owner_key = ${ownerKey}
    ORDER BY id DESC
    LIMIT ${limit}
  `) as Array<{
    kind: string;
    cents_delta: number;
    period: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    kind: r.kind,
    centsDelta: Number(r.cents_delta),
    period: r.period,
    createdAt: r.created_at,
  }));
}
