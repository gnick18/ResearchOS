// Billing plan catalog (flat bundle plans, Grant 2026-06-07).
//
// The chosen model is FLAT bundle plans, not per-unit metering. One plan is the
// only purchasable thing; each plan pairs a STORAGE cap with a monthly ACTIVITY
// allowance (the write-op ceiling that drives the throttle), for one flat price.
// The metered per-GB rate survives only as the a-la-carte comparison anchor in
// the UI, it is not charged.
//
// NUMBERS ARE PROVISIONAL. Per docs/proposals/PRICING_COST_MODEL.md the prices
// and allowances are placeholders sized by the cost-recovery formula, to be
// finalized from ~2-4 weeks of beta tracking before billing is ever turned on.
// Beta is free for everyone (BILLING_ENABLED off); this catalog is the machinery
// that is ready to flip on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { BYTES_PER_GB } from "./config";

/** Audience a plan applies to. Lab plans are pooled across members. */
export type PlanAudience = "individual" | "lab";

export interface Plan {
  /** Stable id, also the key used in the subscription row + Stripe metadata. */
  id: string;
  /** Display name. */
  name: string;
  audience: PlanAudience;
  /** Storage cap in bytes (flat included up to this, not metered on use). */
  storageBytes: number;
  /**
   * Monthly write-operation allowance. This is the throttle ceiling, not a
   * billable quantity. Past it, sync degrades (see the throttle), never a charge.
   * For lab plans this is the pooled allowance across all members.
   */
  activityWritesPerMonth: number;
  /** Flat monthly price in cents. 0 for the free plan. */
  priceCents: number;
  /**
   * The Stripe Price id for this plan's flat subscription, read from env so the
   * same catalog works in test and live. Undefined for the free plan (no charge)
   * and until the env is configured (beta).
   */
  stripePriceEnv?: string;
}

const GB = BYTES_PER_GB;
const M = 1_000_000;

// --- individual plans -------------------------------------------------------

export const INDIVIDUAL_PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    audience: "individual",
    storageBytes: 1 * GB,
    activityWritesPerMonth: 1 * M,
    priceCents: 0,
  },
  {
    id: "plus",
    name: "Plus",
    audience: "individual",
    storageBytes: 50 * GB,
    activityWritesPerMonth: 3 * M,
    priceCents: 800, // ~$8/mo, provisional (cost-recovery)
    stripePriceEnv: "STRIPE_PRICE_PLUS",
  },
  {
    id: "pro",
    name: "Pro",
    audience: "individual",
    storageBytes: 250 * GB,
    activityWritesPerMonth: 10 * M,
    priceCents: 3200, // ~$32/mo, provisional
    stripePriceEnv: "STRIPE_PRICE_PRO",
  },
];

// --- lab plans (pooled across members) --------------------------------------

export const LAB_PLANS: Plan[] = [
  {
    id: "lab_free",
    name: "Lab Free",
    audience: "lab",
    storageBytes: 1 * GB, // per member, pooled at resolution time
    activityWritesPerMonth: 1 * M, // per member, pooled
    priceCents: 0,
  },
  {
    id: "lab_plus",
    name: "Lab Plus",
    audience: "lab",
    storageBytes: 100 * GB,
    activityWritesPerMonth: 15 * M,
    priceCents: 1500, // ~$15/mo, provisional
    stripePriceEnv: "STRIPE_PRICE_LAB_PLUS",
  },
  {
    id: "lab_pro",
    name: "Lab Pro",
    audience: "lab",
    storageBytes: 500 * GB,
    activityWritesPerMonth: 50 * M,
    priceCents: 4500, // ~$45/mo, provisional
    stripePriceEnv: "STRIPE_PRICE_LAB_PRO",
  },
];

export const ALL_PLANS: Plan[] = [...INDIVIDUAL_PLANS, ...LAB_PLANS];

/** The free plan for an audience, the default every account starts on. */
export function freePlan(audience: PlanAudience): Plan {
  return audience === "lab" ? LAB_PLANS[0] : INDIVIDUAL_PLANS[0];
}

/** Look up a plan by id, or null if unknown. */
export function getPlan(id: string | null | undefined): Plan | null {
  if (!id) return null;
  return ALL_PLANS.find((p) => p.id === id) ?? null;
}

/**
 * The plan an account is on, falling back to the audience's free plan when the
 * stored id is missing or unknown (so a bad/legacy value never grants paid room).
 */
export function planOrFree(id: string | null | undefined, audience: PlanAudience): Plan {
  return getPlan(id) ?? freePlan(audience);
}

/** Whether a plan is a paid tier (has a price and a Stripe price env). */
export function isPaidPlan(plan: Plan): boolean {
  return plan.priceCents > 0;
}

/** The Stripe Price id for a paid plan, or null if unset (beta / free). */
export function stripePriceId(plan: Plan): string | null {
  if (!plan.stripePriceEnv) return null;
  return process.env[plan.stripePriceEnv] ?? null;
}
