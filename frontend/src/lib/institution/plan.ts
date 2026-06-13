// Institution tier: the plan-builder rate model, one tier up from dept/plan.ts.
//
// Like departments, institutions do NOT pick fixed tiers (BILLING_FACTS.md): they
// BUILD a plan from inputs and the monthly rate DERIVES = cost recovery (pooled
// storage across all member depts) + a per-active-lab sustaining contribution.
//
// This is the SAME computeCostRecovery model the public /pricing institution
// builder uses, so the dashboard preview, the marketing page, and the invoice all
// agree. The sustaining contribution scales with the TOTAL active labs across the
// institution's departments, so a large department (more labs) contributes more
// than a small one. It is NOT a flat per-department fee. The underlying
// assumptions are FLAGGED placeholders Grant tunes; nothing here is a published
// price.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { FREE_GB_PER_LAB, SUSTAIN_PER_LAB } from "@/lib/pricing/assumptions";
import { computeCostRecovery } from "@/lib/pricing/cost-math";

/** The sustaining contribution per active lab, cents per month. The institution
 *  pays this for every lab across all its departments, so the contribution
 *  adapts to the size of each department. */
export const INSTITUTION_RATE = {
  perLabSustainCents: SUSTAIN_PER_LAB * 100,
};

export interface InstitutionRateInputs {
  /** Total active labs across all member departments (drives the sustaining
   *  contribution and the free pool). This is what makes the rate adapt to the
   *  real size of the institution rather than a flat per-department fee. */
  activeLabs: number;
  /** Pooled storage across all the institution's lab pools, in GB. */
  storageGB: number;
}

export interface InstitutionRateBreakdown {
  /** Our bare cost to run the storage (recovery curve), cents per month. */
  recoveryCents: number;
  /** Sustaining contribution (total active labs times the per-lab rate), cents. */
  sustainCents: number;
  /** The monthly rate, recovery + sustaining, cents. */
  totalCents: number;
}

/**
 * Derive the monthly rate from the built plan via the shared cost-recovery model.
 * Pure + dependency-free so it is unit-testable and shared by the builder UI and
 * the invoice path. The free pool is one FREE_GB_PER_LAB allowance per active lab.
 */
export function deriveInstitutionRate(
  inputs: InstitutionRateInputs,
): InstitutionRateBreakdown {
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
