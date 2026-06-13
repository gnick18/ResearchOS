// Department tier: the plan-builder rate model.
//
// Depts do NOT pick fixed tiers (BILLING_FACTS.md): they BUILD a plan from inputs
// and the monthly rate DERIVES = cost recovery (storage) + a per-active-lab
// sustaining contribution. This is the one place that math lives, so the builder
// UI and the Stripe invoice agree.
//
// The rate derives from computeCostRecovery (lib/pricing/cost-math.ts), the SAME
// function the public /pricing department + institution builders use, so the
// dashboard preview, the marketing page, and the procurement invoice are all the
// one market-researched model. The sustaining contribution scales with the
// number of ACTIVE LABS, so it adapts to the size of the department rather than
// being a flat per-entity fee. The underlying assumptions are FLAGGED
// placeholders Grant tunes; nothing here is a published price.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { FREE_GB_PER_LAB, SUSTAIN_PER_LAB } from "@/lib/pricing/assumptions";
import { computeCostRecovery } from "@/lib/pricing/cost-math";

/** The sustaining contribution per active lab, cents per month. Exposed for the
 *  dashboard breakdown line. The storage side is not a flat per-unit rate, it is
 *  the cost-recovery curve in computeCostRecovery, so there is no per-TB constant. */
export const DEPT_RATE = {
  perLabSustainCents: SUSTAIN_PER_LAB * 100,
};

export interface DeptRateInputs {
  /** Active labs in the department (drives the sustaining contribution and the
   *  free pool, since each lab pool gets the free allowance). */
  activeLabs: number;
  /** Pooled storage across the department's lab pools, in GB. */
  storageGB: number;
}

export interface DeptRateBreakdown {
  /** Our bare cost to run the storage (recovery curve), cents per month. */
  recoveryCents: number;
  /** Sustaining contribution (active labs times the per-lab rate), cents. */
  sustainCents: number;
  /** The monthly rate, recovery + sustaining, cents. */
  totalCents: number;
}

/**
 * Derive the monthly rate from the built plan via the shared cost-recovery model.
 * Pure + dependency-free so it is unit-testable and shared by the builder UI and
 * the invoice path. The free pool is one FREE_GB_PER_LAB allowance per active lab.
 */
export function deriveDeptRate(inputs: DeptRateInputs): DeptRateBreakdown {
  const activeLabs = Math.max(0, Math.floor(inputs.activeLabs));
  const storageGB = Math.max(0, inputs.storageGB);
  const { recovery, sustain, rate } = computeCostRecovery({
    storageGB,
    freeGB: activeLabs * FREE_GB_PER_LAB,
    activeLabs,
  });
  return {
    recoveryCents: Math.round(recovery * 100),
    sustainCents: Math.round(sustain * 100),
    totalCents: Math.round(rate * 100),
  };
}

/** Whole-dollar formatting helper for display. */
export function centsToUsd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
