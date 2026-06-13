// Institution tier: the plan-builder rate model, one tier up from dept/plan.ts.
//
// Like departments, institutions do NOT pick fixed tiers (BILLING_FACTS.md): they
// BUILD a plan from inputs and the monthly rate DERIVES = cost recovery (pooled
// storage across all member depts) + a per-active-department sustaining
// contribution. This is the one place that math lives so the builder UI and (the
// later) Stripe invoice agree.
//
// The constants here are ILLUSTRATIVE placeholders; the live numbers belong in
// pricing/assumptions.ts and should be threaded in before charging.
//
// No emojis, no em-dashes, no mid-sentence colons.

/** Illustrative placeholders. Replace with pricing/assumptions.ts before billing. */
export const INSTITUTION_RATE = {
  /** Cost-recovery for pooled storage, dollars per TB per month. */
  storagePerTbCents: 12288, // ~ $0.12/GB x 1024
  /** Sustaining contribution per active department, dollars per month. */
  perDeptSustainCents: 25000,
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
