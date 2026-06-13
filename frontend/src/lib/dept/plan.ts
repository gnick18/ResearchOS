// Department tier: the plan-builder rate model.
//
// Depts do NOT pick fixed tiers (BILLING_FACTS.md): they BUILD a plan from inputs
// and the monthly rate DERIVES = cost recovery (storage) + a per-active-lab
// sustaining contribution. This is the one place that math lives, so the builder
// UI and (Phase 3) the Stripe invoice agree.
//
// The rate now derives from pricing/assumptions.ts (the single source the public
// /pricing builders also read), so the dashboard preview and the Stripe invoice
// agree with the published cost model. Those assumptions are still FLAGGED
// placeholders Grant tunes; nothing here is a published price.
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  BLENDED_PER_GB_MO,
  BUFFER,
  SUSTAIN_PER_LAB,
} from "@/lib/pricing/assumptions";

/** Whole-cents-per-TB-per-month storage cost recovery, derived from the blended
 *  per-GB cost plus the operating buffer (1024 GB per TB, dollars to cents). */
const STORAGE_PER_TB_CENTS = Math.round(
  BLENDED_PER_GB_MO * (1 + BUFFER) * 1024 * 100,
);

/** Rate constants derived from the flagged pricing assumptions. */
export const DEPT_RATE = {
  /** Cost-recovery for pooled storage, cents per TB per month. */
  storagePerTbCents: STORAGE_PER_TB_CENTS,
  /** Sustaining contribution per active lab, cents per month. */
  perLabSustainCents: SUSTAIN_PER_LAB * 100,
};

export interface DeptRateInputs {
  /** Active labs (drives the sustaining contribution). */
  labs: number;
  /** Pooled storage in whole TB (drives cost recovery). */
  storageTb: number;
}

export interface DeptRateBreakdown {
  storageCents: number;
  sustainCents: number;
  totalCents: number;
}

/**
 * Derive the monthly rate from the built plan. Pure + dependency-free so it is
 * unit-testable and shared by the builder UI and the invoice path.
 */
export function deriveDeptRate(inputs: DeptRateInputs): DeptRateBreakdown {
  const labs = Math.max(0, Math.floor(inputs.labs));
  const storageTb = Math.max(0, inputs.storageTb);
  const storageCents = Math.round(storageTb * DEPT_RATE.storagePerTbCents);
  const sustainCents = labs * DEPT_RATE.perLabSustainCents;
  return { storageCents, sustainCents, totalCents: storageCents + sustainCents };
}

/** Whole-dollar formatting helper for display. */
export function centsToUsd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
