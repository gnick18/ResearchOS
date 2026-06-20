// Billing cadence helpers (flat sticker tiers, Grant 2026-06-15).
//
// A flat sticker tier billed less often than monthly amortizes Stripe's fixed
// $0.30 over more months. A $1/mo charge billed monthly loses ~33% to fees;
// billed annually it loses ~5%. That is why the cheap entry tiers are 6/12-month
// only. monthly reproduces stripeOn() exactly, so existing callers are unchanged.
//
// Extracted from modeling.ts during GB-ladder retirement (2026-06-19).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { STRIPE_FIXED, STRIPE_PCT } from "./assumptions";

export type BillingCadence = "monthly" | "semiannual" | "annual";

/** Stripe charges per year for a cadence. */
export function cadenceChargesPerYear(c: BillingCadence): number {
  return c === "monthly" ? 12 : c === "semiannual" ? 2 : 1;
}

/** Per-month Stripe cost for a monthly-equivalent price billed at a cadence.
 *  monthly === stripeOn(price). Longer cadences spread the fixed fee, which is
 *  what makes a $1 or $2 tier viable. */
export function stripeMonthlyAmortized(
  monthlyPrice: number,
  cadence: BillingCadence,
): number {
  if (monthlyPrice <= 0) return 0;
  const annual = monthlyPrice * 12;
  const fees =
    cadenceChargesPerYear(cadence) * STRIPE_FIXED + STRIPE_PCT * annual;
  return fees / 12;
}
