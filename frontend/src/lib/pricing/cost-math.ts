/**
 * Shared cost-recovery math for the department and institution plan builders on
 * /pricing. One function so both builders compute identically, and so the
 * formula lives next to the FLAGGED assumptions it reads.
 *
 * The formula mirrors the approved mockup exactly:
 *   billable GB  = max(0, estimated storage - free pool)
 *   raw          = billable * blended per-GB cost
 *   pre-Stripe   = raw + raw * buffer
 *   recovery     = billable <= 0 ? 0 : (pre + stripeFixed) / (1 - stripePct)
 *   sustain      = round(active labs) * per-lab sustaining contribution
 *   rate         = recovery + sustain
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import {
  BLENDED_PER_GB_MO,
  BUFFER,
  STRIPE_FIXED,
  STRIPE_PCT,
  SUSTAIN_PER_LAB,
} from "./assumptions";

export interface CostRecoveryInput {
  /** Estimated total storage across all the lab pools, in GB. */
  storageGB: number;
  /** Free storage pooled across all the labs, in GB. */
  freeGB: number;
  /** Number of active labs (used for the sustaining contribution). */
  activeLabs: number;
  /** Extra processing cost passed through when the payer is international, as a
   *  fraction of the charged amount (e.g. INTL_PROCESSING_PCT). Defaults to 0, so
   *  a domestic rate is unchanged. */
  intlPct?: number;
}

export interface CostRecoveryResult {
  /** Billable storage above the free pool, in GB. */
  billableGB: number;
  /** Our bare cost to run it, dollars per month (storage + buffer + Stripe). */
  recovery: number;
  /** Sustaining contribution, dollars per month. */
  sustain: number;
  /** Extra international processing passed through, dollars per month (0 domestic). */
  intlFee: number;
  /** The monthly rate, recovery + sustain + intlFee. */
  rate: number;
}

export function computeCostRecovery({
  storageGB,
  freeGB,
  activeLabs,
  intlPct = 0,
}: CostRecoveryInput): CostRecoveryResult {
  const billableGB = Math.max(0, storageGB - freeGB);
  const raw = billableGB * BLENDED_PER_GB_MO;
  const pre = raw + raw * BUFFER;
  const recovery =
    billableGB <= 0 ? 0 : (pre + STRIPE_FIXED) / (1 - STRIPE_PCT);
  const sustain = Math.round(activeLabs) * SUSTAIN_PER_LAB;
  // The extra international fee applies to the whole charged amount (Stripe takes
  // its cut of the full invoice), so it grosses up recovery + sustain.
  const intlFee = Math.max(0, intlPct) * (recovery + sustain);
  return {
    billableGB,
    recovery,
    sustain,
    intlFee,
    rate: recovery + sustain + intlFee,
  };
}

/** "$2.98" style, two decimals. Matches the mockup's usd() helper. */
export function usd(n: number): string {
  return "$" + n.toFixed(2);
}

/** "$4,265" style, whole dollars with thousands separators. Matches the
 *  mockup's usd0() helper used by the competitor savings tool. */
export function usd0(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
