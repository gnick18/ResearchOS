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
}

export interface CostRecoveryResult {
  /** Billable storage above the free pool, in GB. */
  billableGB: number;
  /** Our bare cost to run it, dollars per month (storage + buffer + Stripe). */
  recovery: number;
  /** Sustaining contribution, dollars per month. */
  sustain: number;
  /** The monthly rate, recovery + sustain. */
  rate: number;
}

export function computeCostRecovery({
  storageGB,
  freeGB,
  activeLabs,
}: CostRecoveryInput): CostRecoveryResult {
  const billableGB = Math.max(0, storageGB - freeGB);
  const raw = billableGB * BLENDED_PER_GB_MO;
  const pre = raw + raw * BUFFER;
  const recovery =
    billableGB <= 0 ? 0 : (pre + STRIPE_FIXED) / (1 - STRIPE_PCT);
  const sustain = Math.round(activeLabs) * SUSTAIN_PER_LAB;
  return { billableGB, recovery, sustain, rate: recovery + sustain };
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
