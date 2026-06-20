// Single source of truth for customer-facing PRICE figures.
//
// Grant's rule: "change a price once and it updates website-wide instead of 15
// different price vars." Every product-facing surface (pricing page, settings,
// AI top-ups, marketing) imports its dollar figures from here, never a hardcoded
// "$N" literal. Where an engine constant already owns a number (the Model-A plan
// base fees + markups), this re-derives from it, so the billing math and the
// displayed price can never drift.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { FOUNDING_LAB_BASE_CENTS, MODEL_A_PLANS } from "./model-a/pricing";

/** Format integer cents as a compact USD string ("$3", "$3.50", "$12.99"). */
export function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export type PaidPlanId = "solo" | "lab" | "dept";

export interface PlanPriceDisplay {
  id: PaidPlanId;
  name: string;
  /** Monthly base fee in cents (the canonical value, from MODEL_A_PLANS). */
  baseCents: number;
  /** Formatted base fee, e.g. "$3", "$25", "$50". */
  base: string;
  /** What the base covers, e.g. "/mo" or "/mo per lab". */
  baseSuffix: string;
  /** The usage markup multiplier (5x solo, 7x lab, 6x dept). */
  usageMarkup: number;
  /** Lab only: the displayed base is the founding lock-in rate, below the
   *  MODEL_A_PLANS steady-state base. */
  founding?: boolean;
  /** Dept only: pricing is TBD, so the surface shows a contact button, not a
   *  price. */
  contactOnly?: boolean;
}

function planDisplay(id: PaidPlanId, baseSuffix: string): PlanPriceDisplay {
  const plan = MODEL_A_PLANS[id];
  return {
    id,
    name: plan.name,
    baseCents: plan.baseFeeCents,
    base: usd(plan.baseFeeCents),
    baseSuffix,
    usageMarkup: plan.usageMarkup,
  };
}

/** The paid plans' display prices, derived from MODEL_A_PLANS. Solo bills once,
 *  lab and dept bill the base per lab. */
export const PLAN_PRICES: Record<PaidPlanId, PlanPriceDisplay> = {
  solo: planDisplay("solo", "/mo"),
  // Lab is shown publicly at the FOUNDING lock-in rate, below the engine
  // steady-state base in MODEL_A_PLANS (which is never shown publicly).
  lab: {
    ...planDisplay("lab", "/mo per lab"),
    baseCents: FOUNDING_LAB_BASE_CENTS,
    base: usd(FOUNDING_LAB_BASE_CENTS),
    founding: true,
  },
  // Department pricing is being revisited, so it shows contact/TBD publicly.
  dept: { ...planDisplay("dept", "/mo per lab"), contactOnly: true },
};

/** Prepaid AI token pack dollar tiers. The packs ARE these amounts (the AI meter
 *  in ai-config keys PACK_TOKENS by them), so this is their single home for copy. */
export const AI_PACK_DOLLARS = [10, 25, 50] as const;

/** GitHub Sponsors recognition tiers (a thank-you + credits placement, NOT the
 *  product plans). Centralized so the figure changes in one place. */
export const SPONSOR_TIERS = {
  labMonthly: 25,
  instituteMonthly: 100,
} as const;

// Department pricing is contact/TBD on the public surface (Grant 2026-06-19), so
// these discount constants are now OPERATOR-ONLY (the /admin modeling tool). They
// describe the steady-state dept vs lab economics from MODEL_A_PLANS, NOT public
// copy, so they stay stable while the public lab price is the founding lock-in.

/** Dollars off the per-lab base a department pays vs a standalone lab (e.g. $5). */
export const DEPT_PER_LAB_DISCOUNT_CENTS =
  MODEL_A_PLANS.lab.baseFeeCents - MODEL_A_PLANS.dept.baseFeeCents;

/** Percent off cloud usage a department gets vs a standalone lab, from the lower
 *  usage multiplier (lab 7x vs dept 6x -> about 14% off). Rounded for copy. */
export const DEPT_USAGE_DISCOUNT_PCT = Math.round(
  (1 - MODEL_A_PLANS.dept.usageMarkup / MODEL_A_PLANS.lab.usageMarkup) * 100,
);
