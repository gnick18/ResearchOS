// Model A billing, the off-session charge run (engine step 4).
//
// Finds payers whose accrued balance crossed the threshold and runs their card on
// file off-session for the accrued amount. recordCharge is idempotent on the
// provider charge id, so recording here on synchronous success AND again from the
// payment_intent.succeeded webhook draws the balance down exactly once. One
// failing payer never aborts the run (a declined card is retried next run, the
// balance simply stays accrued).
//
// The charger and sql are injectable so the run logic is unit-tested without
// hitting Stripe.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { ACCRUAL_CHARGE_THRESHOLD_CENTS } from "./pricing";
import {
  listChargeableOwners,
  recordCharge,
  type ChargeableOwner,
} from "./ledger";
import type { Sql } from "./ledger-db";

/** Creates and confirms an off-session payment for a payer. Returns the provider
 *  charge id on success (used as the idempotency key for recordCharge). */
export type OffSessionCharger = (args: {
  ownerKey: string;
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
}) => Promise<{ ok: boolean; chargeId?: string; error?: string }>;

export interface ChargeRunSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  totalChargedCents: number;
}

export interface ChargeRunOptions {
  /** Owners to charge. Defaults to listChargeableOwners(threshold). */
  owners?: ChargeableOwner[];
  /** Balance at or above which to charge. Defaults to the $5 threshold. */
  threshold?: number;
  sql?: Sql;
}

/**
 * Run every payer over the threshold against their card on file. Resilient (a
 * decline is counted, not fatal) and idempotent (recordCharge keys on the charge
 * id). Returns a summary for the cron log.
 */
export async function runChargeRun(
  charger: OffSessionCharger,
  opts: ChargeRunOptions = {},
): Promise<ChargeRunSummary> {
  const threshold = opts.threshold ?? ACCRUAL_CHARGE_THRESHOLD_CENTS;
  const owners = opts.owners ?? (await listChargeableOwners(threshold, opts.sql));

  let succeeded = 0;
  let failed = 0;
  let totalChargedCents = 0;

  for (const o of owners) {
    const amountCents = o.accruedCents;
    let res: Awaited<ReturnType<OffSessionCharger>>;
    try {
      res = await charger({
        ownerKey: o.ownerKey,
        customerId: o.customerId,
        paymentMethodId: o.paymentMethodId,
        amountCents,
      });
    } catch (e) {
      failed += 1;
      void e;
      continue;
    }
    if (res.ok && res.chargeId) {
      // Idempotent draw-down. The webhook records the same charge id too, so this
      // is safe whether the confirm resolved synchronously or lands via webhook.
      await recordCharge(o.ownerKey, amountCents, res.chargeId, opts.sql);
      succeeded += 1;
      totalChargedCents += amountCents;
    } else {
      failed += 1;
    }
  }

  return { attempted: owners.length, succeeded, failed, totalChargedCents };
}
