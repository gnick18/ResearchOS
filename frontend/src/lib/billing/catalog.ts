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

import { MODEL_A_PLANS } from "./model-a/pricing";

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
  lab: planDisplay("lab", "/mo per lab"),
  dept: planDisplay("dept", "/mo per lab"),
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
