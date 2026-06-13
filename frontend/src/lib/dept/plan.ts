// Department tier: the plan-builder rate model.
//
// Depts do NOT pick fixed tiers (BILLING_FACTS.md): they BUILD a plan from inputs
// and the monthly rate DERIVES = cost recovery (storage) + a per-active-lab
// sustaining contribution. This is the one place that math lives, so the builder
// UI and (Phase 3) the Stripe invoice agree.
//
// The constants here are ILLUSTRATIVE Phase 2 placeholders; the live numbers
// belong in pricing/assumptions.ts and should be threaded in before charging.
//
// No emojis, no em-dashes, no mid-sentence colons.

/** Illustrative placeholders. Replace with pricing/assumptions.ts before billing. */
export const DEPT_RATE = {
  /** Cost-recovery for pooled storage, dollars per TB per month. */
  storagePerTbCents: 12288, // ~ $0.12/GB x 1024
  /** Sustaining contribution per active lab, dollars per month. */
  perLabSustainCents: 3500,
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
