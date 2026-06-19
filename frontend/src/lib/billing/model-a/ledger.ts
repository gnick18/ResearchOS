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

export interface AccrueResult {
  /** Whether this call actually appended an accrual row (false on a period re-run). */
  accrued: boolean;
  /** The payer's balance after (unchanged on a re-run). */
  balanceCents: number;
}

/**
 * Accrue one payer's marked-up charge for one period onto their running balance.
 * Idempotent on (ownerKey, period): a re-run inserts no second ledger row, does
 * not move the balance, and reports accrued=false so callers can report honestly.
 */
export async function accruePeriodCharge(
  ownerKey: string,
  period: string,
  charge: PeriodCharge,
  sql: Sql = getSql(),
): Promise<AccrueResult> {
  await ensureCloudLedgerSchema(sql);
  const idem = accrualIdemKey(ownerKey, period);

  // Step 1: append the accrual row, idempotent on the period idem key.
  const inserted = (await sql`
    INSERT INTO cloud_usage_ledger
      (owner_key, kind, cents_delta, period, base_cents, usage_cents, storage_cents, hosted_cents, idem_key)
    VALUES
      (${ownerKey}, 'accrual', ${charge.totalCents}, ${period}, ${charge.baseCents},
       ${charge.usageCents}, ${charge.storageCents}, ${charge.hostedCents}, ${idem})
    ON CONFLICT (idem_key) WHERE idem_key IS NOT NULL DO NOTHING
    RETURNING id
  `) as Array<{ id: number }>;

  // Step 2: only move the balance if the ledger row was actually inserted.
  if (inserted.length === 0) {
    return { accrued: false, balanceCents: await getCloudBalance(ownerKey, sql) };
  }
  const rows = (await sql`
    INSERT INTO cloud_balance (owner_key, accrued_cents)
    VALUES (${ownerKey}, ${charge.totalCents})
    ON CONFLICT (owner_key) DO UPDATE
      SET accrued_cents = cloud_balance.accrued_cents + ${charge.totalCents},
          updated_at = now()
    RETURNING accrued_cents
  `) as Array<{ accrued_cents: number }>;
  return { accrued: true, balanceCents: Number(rows[0]?.accrued_cents ?? charge.totalCents) };
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
    ON CONFLICT (idem_key) WHERE idem_key IS NOT NULL DO NOTHING
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

/** Save the card on file for a payer (from the SetupIntent at checkout). The
 *  off-session charge job attaches this payment method to the PaymentIntent. */
export async function setCloudPaymentMethod(
  ownerKey: string,
  stripeCustomerId: string,
  paymentMethodId: string,
  sql: Sql = getSql(),
): Promise<void> {
  await ensureCloudLedgerSchema(sql);
  await sql`
    INSERT INTO cloud_balance (owner_key, stripe_customer_id, stripe_payment_method_id)
    VALUES (${ownerKey}, ${stripeCustomerId}, ${paymentMethodId})
    ON CONFLICT (owner_key) DO UPDATE
      SET stripe_customer_id = ${stripeCustomerId},
          stripe_payment_method_id = ${paymentMethodId},
          updated_at = now()
  `;
}

export interface CloudCardOnFile {
  customerId: string;
  paymentMethodId: string;
}

/** The card on file for a payer, or null if none saved yet. */
export async function getCloudPaymentMethod(
  ownerKey: string,
  sql: Sql = getSql(),
): Promise<CloudCardOnFile | null> {
  await ensureCloudLedgerSchema(sql);
  const rows = (await sql`
    SELECT stripe_customer_id, stripe_payment_method_id
    FROM cloud_balance WHERE owner_key = ${ownerKey}
  `) as Array<{ stripe_customer_id: string | null; stripe_payment_method_id: string | null }>;
  const row = rows[0];
  if (!row || !row.stripe_customer_id || !row.stripe_payment_method_id) return null;
  return { customerId: row.stripe_customer_id, paymentMethodId: row.stripe_payment_method_id };
}

/** Set (or clear, with null) a payer's settable monthly spend cap in cents. When
 *  the period's projected charge exceeds it, cloud sync pauses (the local app
 *  never stops) until the next period or the cap is raised. */
export async function setMonthlyCap(
  ownerKey: string,
  capCents: number | null,
  sql: Sql = getSql(),
): Promise<void> {
  await ensureCloudLedgerSchema(sql);
  await sql`
    INSERT INTO cloud_balance (owner_key, monthly_cap_cents)
    VALUES (${ownerKey}, ${capCents})
    ON CONFLICT (owner_key) DO UPDATE
      SET monthly_cap_cents = ${capCents}, updated_at = now()
  `;
}

/** A payer's monthly cap in cents, or null if none set (no per-owner cap; the
 *  global cost breaker still applies). */
export async function getMonthlyCap(
  ownerKey: string,
  sql: Sql = getSql(),
): Promise<number | null> {
  await ensureCloudLedgerSchema(sql);
  const rows = (await sql`
    SELECT monthly_cap_cents FROM cloud_balance WHERE owner_key = ${ownerKey}
  `) as Array<{ monthly_cap_cents: number | null }>;
  const v = rows[0]?.monthly_cap_cents;
  return v == null ? null : Number(v);
}

export interface ChargeableOwner {
  ownerKey: string;
  accruedCents: number;
  customerId: string;
  paymentMethodId: string;
  /** ISO trial-end timestamp, or null. The charge run suppresses the card while
   *  now < trialEndsAt (lab free trial), via labTrialDecision. A chargeable owner
   *  by definition has a card, so once the trial ends they charge normally. */
  trialEndsAt: string | null;
}

/** Payers whose accrued balance is at or above the threshold AND who have a card
 *  on file, so the charge job can run them off-session. trial_ends_at rides along
 *  so the charge run can suppress the card during a lab free trial without a
 *  second query. */
export async function listChargeableOwners(
  thresholdCents: number,
  sql: Sql = getSql(),
): Promise<ChargeableOwner[]> {
  await ensureCloudLedgerSchema(sql);
  const rows = (await sql`
    SELECT owner_key, accrued_cents, stripe_customer_id, stripe_payment_method_id, trial_ends_at
    FROM cloud_balance
    WHERE accrued_cents >= ${thresholdCents}
      AND stripe_customer_id IS NOT NULL
      AND stripe_payment_method_id IS NOT NULL
  `) as Array<{
    owner_key: string;
    accrued_cents: number;
    stripe_customer_id: string;
    stripe_payment_method_id: string;
    trial_ends_at: string | null;
  }>;
  return rows.map((r) => ({
    ownerKey: r.owner_key,
    accruedCents: Number(r.accrued_cents),
    customerId: r.stripe_customer_id,
    paymentMethodId: r.stripe_payment_method_id,
    trialEndsAt: r.trial_ends_at,
  }));
}

export interface LabTrialRow {
  /** ISO trial-end timestamp, or null if this owner is not on a trial. */
  trialEndsAt: string | null;
  /** Whether a card is on file (the day-90 fork: resume vs pause). */
  hasCard: boolean;
}

/** The trial state for an owner (trial-end timestamp + whether a card is on
 *  file). Feeds labTrialPhase / labTrialDecision. A missing row reads as "no
 *  trial, no card", which is the pre-trial engine default. */
export async function getLabTrialState(
  ownerKey: string,
  sql: Sql = getSql(),
): Promise<LabTrialRow> {
  await ensureCloudLedgerSchema(sql);
  const rows = (await sql`
    SELECT trial_ends_at, stripe_customer_id, stripe_payment_method_id
    FROM cloud_balance WHERE owner_key = ${ownerKey}
  `) as Array<{
    trial_ends_at: string | null;
    stripe_customer_id: string | null;
    stripe_payment_method_id: string | null;
  }>;
  const row = rows[0];
  return {
    trialEndsAt: row?.trial_ends_at ?? null,
    hasCard: !!(row?.stripe_customer_id && row?.stripe_payment_method_id),
  };
}

/**
 * Start (or refresh) a lab's free trial by stamping trial_ends_at. Additive and
 * idempotent on the owner key. Never touches the card, the balance, or the cap,
 * so it is safe to call at signup with no Stripe involvement. Only stamps when no
 * trial is already set (a second call does not extend a running trial), unless
 * `force` is passed.
 */
export async function startLabTrial(
  ownerKey: string,
  trialEndsAtIso: string,
  sql: Sql = getSql(),
  force = false,
): Promise<void> {
  await ensureCloudLedgerSchema(sql);
  if (force) {
    await sql`
      INSERT INTO cloud_balance (owner_key, trial_ends_at)
      VALUES (${ownerKey}, ${trialEndsAtIso})
      ON CONFLICT (owner_key) DO UPDATE
        SET trial_ends_at = ${trialEndsAtIso}, updated_at = now()
    `;
    return;
  }
  // Stamp only if no trial is set yet. A re-run (a reload, a double submit) must
  // not push the end date out, so we leave an existing trial_ends_at untouched.
  await sql`
    INSERT INTO cloud_balance (owner_key, trial_ends_at)
    VALUES (${ownerKey}, ${trialEndsAtIso})
    ON CONFLICT (owner_key) DO UPDATE
      SET trial_ends_at = COALESCE(cloud_balance.trial_ends_at, ${trialEndsAtIso}),
          updated_at = now()
  `;
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
