/**
 * Pure cost math behind the operator-only Price modeling tool (the modal on
 * /business). It ports the two interactive mockups
 *   docs/mockups/2026-06-14-storage-pricing-models.html  (per-subscriber)
 *   docs/mockups/2026-06-14-sustainability-model.html     (sustainability)
 * into one tested module so the modal is a thin view over honest numbers.
 *
 * EVERYTHING here reads from the single sources of truth:
 *   lib/pricing/assumptions.ts  (BLENDED_PER_GB_MO, BUFFER, STRIPE_*, SUSTAIN_PER_LAB,
 *                                FREE_GB_PER_LAB, ACTIVITY_PER_M_WRITES, ...)
 *   lib/billing/plans.ts        (the tier caps + activity allowances)
 *   lib/pricing/cost-math.ts    (computeCostRecovery, reused, never re-derived)
 * Change a number in those files and this tool moves with it.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import {
  ACTIVITY_PER_M_WRITES,
  BUFFER,
  BLENDED_PER_GB_MO,
  FREE_GB_PER_LAB,
  STRIPE_FIXED,
  STRIPE_PCT,
  SUSTAIN_PER_LAB,
} from "./assumptions";
import { computeCostRecovery } from "./cost-math";
import { ALL_PLANS, getPlan, type Plan } from "../billing/plans";
import { BYTES_PER_GB } from "../billing/config";

/** The free individual pool, in GB. Individual Free is the same 5 GB as a lab
 *  pool today (see plans.ts / FREE_ALLOWANCE_BYTES). Read it from the catalog so
 *  it tracks the plan, not a second copy of the number. */
export const FREE_GB_INDIVIDUAL =
  (getPlan("free")?.storageBytes ?? 5 * BYTES_PER_GB) / BYTES_PER_GB;

/** A tier row the per-subscriber model can select, derived from a real plan. */
export interface ModelTier {
  id: string;
  name: string;
  /** Storage cap in GB. */
  capGB: number;
  /** Free pool in GB for this tier's audience. */
  freeGB: number;
  /** Throttle ceiling in millions of writes per month (the activity allowance). */
  throttleM: number;
  audience: Plan["audience"];
}

/** Build the selectable tiers from the live plan catalog. Free pools come from
 *  assumptions (lab pool) and the individual free plan, never re-typed here. */
export function modelTiers(): ModelTier[] {
  return ALL_PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    capGB: p.storageBytes / BYTES_PER_GB,
    freeGB: p.audience === "lab" ? FREE_GB_PER_LAB : FREE_GB_INDIVIDUAL,
    throttleM: p.activityWritesPerMonth / 1_000_000,
    audience: p.audience,
  }));
}

// --- per-subscriber economics ------------------------------------------------

/** Stripe cost on a charged amount (0 when nothing is charged). */
export function stripeOn(price: number): number {
  return price <= 0 ? 0 : price * STRIPE_PCT + STRIPE_FIXED;
}

/** Our bare infra cost for actual usage, dollars per month (storage + activity).
 *  No buffer, no Stripe, this is raw cost. */
export function bareCost(gb: number, actM: number): number {
  return gb * BLENDED_PER_GB_MO + actM * ACTIVITY_PER_M_WRITES;
}

/**
 * Storage-only cost-recovery price for a plan whose cap is `capGB` over a
 * `freeGB` pool. Reuses computeCostRecovery (one active "lab" with no sustaining
 * contribution) so the storage formula is never re-derived here. The recovery
 * field already folds in the buffer and grosses up for Stripe.
 */
export function priceStorageOnly(capGB: number, freeGB: number): number {
  return computeCostRecovery({
    storageGB: capGB,
    freeGB,
    activeLabs: 0,
  }).recovery;
}

/**
 * Storage + activity price. The plan's price also has to recover the activity
 * the throttle allowance lets a user spend, so we add the allowance's activity
 * cost into the raw basis before the buffer + Stripe gross-up. Mirrors the
 * mockup's priceWithActivity exactly.
 */
export function priceWithActivity(
  capGB: number,
  freeGB: number,
  throttleM: number,
): number {
  const billable = Math.max(0, capGB - freeGB);
  if (billable <= 0 && throttleM <= 0) return 0;
  const raw = billable * BLENDED_PER_GB_MO + throttleM * ACTIVITY_PER_M_WRITES;
  const pre = raw + raw * BUFFER;
  return (pre + STRIPE_FIXED) / (1 - STRIPE_PCT);
}

export type PricingModel = "storage" | "activity";

/** The price a tier charges under a chosen model. */
export function tierPrice(tier: ModelTier, model: PricingModel): number {
  return model === "storage"
    ? priceStorageOnly(tier.capGB, tier.freeGB)
    : priceWithActivity(tier.capGB, tier.freeGB, tier.throttleM);
}

// --- billing cadence (solo + lab are 6/12-month only, Grant 2026-06-15) -------
//
// A flat sticker tier billed less often than monthly amortizes Stripe's fixed
// $0.30 over more months. A $1/mo charge billed monthly loses ~33% to fees;
// billed annually it loses ~5%. That is why the cheap entry tiers are 6/12-month
// only. monthly here reproduces stripeOn() exactly, so existing callers are
// unchanged.

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

export interface MarginBreakdown {
  price: number;
  storageCost: number;
  activityCost: number;
  stripe: number;
  /** price - storageCost - activityCost - stripe. Negative means we lose. */
  net: number;
}

/** Per-subscriber P&L for a price against actual storage + write usage. The
 *  cadence defaults to monthly, where the Stripe cost equals stripeOn(price), so
 *  every existing caller is unchanged; the finalize tab passes 6/12-month. */
export function subscriberMargin(
  price: number,
  gb: number,
  actM: number,
  cadence: BillingCadence = "monthly",
): MarginBreakdown {
  const storageCost = gb * BLENDED_PER_GB_MO;
  const activityCost = actM * ACTIVITY_PER_M_WRITES;
  const stripe = stripeMonthlyAmortized(price, cadence);
  return {
    price,
    storageCost,
    activityCost,
    stripe,
    net: price - storageCost - activityCost - stripe,
  };
}

/** Net margin for a price at given usage (the curve value in the chart). */
export function netMargin(
  price: number,
  gb: number,
  actM: number,
  cadence: BillingCadence = "monthly",
): number {
  return subscriberMargin(price, gb, actM, cadence).net;
}

// --- sustainability at scale -------------------------------------------------

/** Per-active-lab members assumed when a tier of the org hierarchy does not ask
 *  member counts directly. Mirrors the mockups (6 members/lab). */
export const MEMBERS_PER_LAB = 6;
/** Estimated per-member shared storage in GB used by the org pools (datasets-ish
 *  mix in the mockups). */
export const PER_MEMBER_GB = 3;

/** A fixed monthly base (infra floor) shown for completeness. Donation/fellowship
 *  funded, not user-loaded. Matches the sustainability mockup's fixedBase. */
export const FIXED_BASE_MONTHLY = 28;

export interface FreeUsageMix {
  /** Percent shares of the free base (need not sum to 100, they are normalized). */
  lightPct: number;
  typicalPct: number;
  heavyPct: number;
  /** The free write cap in millions, the heavy class is maxed to it. */
  capM: number;
}

/** Average monthly cost to us of one free user, given the usage mix + free cap.
 *  Mirrors the sustainability mockup's freeCosts + avgFreeCost. */
export function avgFreeUserCost(mix: FreeUsageMix): number {
  const light = bareCost(0.2, 0.01); // 0.2 GB, 10k writes
  const typical = bareCost(0.7, 0.15); // 0.7 GB, 150k writes
  const heavy = bareCost(1.0, mix.capM); // 1 GB, maxed to the cap
  const total = mix.lightPct + mix.typicalPct + mix.heavyPct || 1;
  return (
    (mix.lightPct * light + mix.typicalPct * typical + mix.heavyPct * heavy) /
    total
  );
}

export interface PayingSide {
  /** Paid individuals (modeled on the Pro tier). */
  paidIndividuals: number;
  /** Paid standalone labs (modeled on the Lab Plus tier). */
  paidLabs: number;
  departments: number;
  labsPerDept: number;
  institutions: number;
  deptsPerInst: number;
  /** Sustain per active lab, dollars per month (the dial). */
  sustainPerLab: number;
}

export interface MoneyIn {
  individuals: number;
  labs: number;
  departments: number;
  institutions: number;
  total: number;
}

/** Margin on one paid plan at a representative real usage. */
function planMargin(
  capGB: number,
  freeGB: number,
  gbUse: number,
  actUse: number,
): number {
  return netMargin(priceStorageOnly(capGB, freeGB), gbUse, actUse);
}

/** Org-pool revenue (sustain + storage recovery net of its tiny cost). */
function orgIn(labs: number, sustainPerLab: number): number {
  if (labs <= 0) return 0;
  const members = labs * MEMBERS_PER_LAB;
  const gb = members * PER_MEMBER_GB;
  const recovery = priceStorageOnly(gb, labs * FREE_GB_PER_LAB);
  const sustain = labs * sustainPerLab;
  const cost = bareCost(gb, members * 0.1) + stripeOn(recovery + sustain);
  return sustain + (recovery - cost);
}

/** Representative dept/institution per-lab effective monthly rate = storage
 *  recovery on a typical lab pool (members * PER_MEMBER_GB over freeGBPerLab) plus
 *  the sustain. The ordering invariant (Grant 2026-06-15) is that this must
 *  exceed the standalone Lab plan, so a lab inside a dept/inst pays MORE than it
 *  would on its own, which is what makes the org tier the solidarity surplus. */
export function orgPerLabRate(
  sustainPerLab: number,
  freeGBPerLab: number,
): number {
  const gb = MEMBERS_PER_LAB * PER_MEMBER_GB;
  return priceStorageOnly(gb, freeGBPerLab) + sustainPerLab;
}

/** Total monthly money in from the paying side. */
export function moneyIn(p: PayingSide): MoneyIn {
  const indMargin = planMargin(100, FREE_GB_INDIVIDUAL, 8, 0.1);
  const labMargin = planMargin(150, FREE_GB_PER_LAB, 40, 0.5);
  const deptLabs = p.departments * p.labsPerDept;
  const instLabs = p.institutions * p.deptsPerInst * 8;
  const individuals = p.paidIndividuals * indMargin;
  const labs = p.paidLabs * labMargin;
  const departments = orgIn(deptLabs, p.sustainPerLab);
  const institutions = orgIn(instLabs, p.sustainPerLab);
  return {
    individuals,
    labs,
    departments,
    institutions,
    total: individuals + labs + departments + institutions,
  };
}

export interface SustainabilityResult {
  avgFreeCost: number;
  totalIn: number;
  freeCost: number;
  fixed: number;
  totalOut: number;
  net: number;
  /** Max free users the paying side can carry before going underwater. */
  breakEvenFreeUsers: number;
  /** Free users supported per paying lab. */
  freePerPayingLab: number;
  /** breakEvenFreeUsers - current free users. */
  headroom: number;
}

/** Full sustainability roll-up for a free base + a paying side + usage mix. */
export function sustainability(
  freeUsers: number,
  mix: FreeUsageMix,
  paying: PayingSide,
): SustainabilityResult {
  const avg = avgFreeUserCost(mix);
  const mi = moneyIn(paying);
  const totalIn = mi.total;
  const freeCost = freeUsers * avg;
  const fixed = FIXED_BASE_MONTHLY;
  const totalOut = freeCost + fixed;
  const net = totalIn - totalOut;
  const breakEvenFreeUsers =
    avg > 0 ? Math.max(0, (totalIn - fixed) / avg) : Number.POSITIVE_INFINITY;
  const payingLabs =
    paying.departments * paying.labsPerDept +
    paying.institutions * paying.deptsPerInst * 8 +
    paying.paidLabs;
  const freePerPayingLab =
    payingLabs > 0 ? breakEvenFreeUsers / payingLabs : Number.NaN;
  return {
    avgFreeCost: avg,
    totalIn,
    freeCost,
    fixed,
    totalOut,
    net,
    breakEvenFreeUsers,
    freePerPayingLab,
    headroom: breakEvenFreeUsers - freeUsers,
  };
}
