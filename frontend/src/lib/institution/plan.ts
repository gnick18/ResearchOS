// Institution tier: the plan-builder rate model, one tier up from dept/plan.ts.
//
// Like departments, institutions do NOT pick fixed tiers (BILLING_FACTS.md): they
// BUILD a plan from inputs and the monthly rate DERIVES = cost recovery (pooled
// storage across all member depts) + a per-active-department sustaining
// contribution. This is the one place that math lives so the builder UI and (the
// later) Stripe invoice agree.
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
  SUSTAIN_PER_DEPT,
} from "@/lib/pricing/assumptions";

/** Whole-cents-per-TB-per-month storage cost recovery, derived from the blended
 *  per-GB cost plus the operating buffer (1024 GB per TB, dollars to cents). */
const STORAGE_PER_TB_CENTS = Math.round(
  BLENDED_PER_GB_MO * (1 + BUFFER) * 1024 * 100,
);

/** Rate constants derived from the flagged pricing assumptions. */
export const INSTITUTION_RATE = {
  /** Cost-recovery for pooled storage, cents per TB per month. */
  storagePerTbCents: STORAGE_PER_TB_CENTS,
  /** Sustaining contribution per active department, cents per month. */
  perDeptSustainCents: SUSTAIN_PER_DEPT * 100,
};

export interface InstitutionRateInputs {
  /** Active departments (drives the sustaining contribution). */
  depts: number;
  /** Pooled storage in whole TB across all member depts (drives cost recovery). */
  storageTb: number;
}

export interface InstitutionRateBreakdown {
  storageCents: number;
  sustainCents: number;
  totalCents: number;
}

/**
 * Derive the monthly rate from the built plan. Pure + dependency-free so it is
 * unit-testable and shared by the builder UI and the invoice path.
 */
export function deriveInstitutionRate(
  inputs: InstitutionRateInputs,
): InstitutionRateBreakdown {
  const depts = Math.max(0, Math.floor(inputs.depts));
  const storageTb = Math.max(0, inputs.storageTb);
  const storageCents = Math.round(storageTb * INSTITUTION_RATE.storagePerTbCents);
  const sustainCents = depts * INSTITUTION_RATE.perDeptSustainCents;
  return { storageCents, sustainCents, totalCents: storageCents + sustainCents };
}

/** Whole-dollar formatting helper for display. */
export function centsToUsd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
