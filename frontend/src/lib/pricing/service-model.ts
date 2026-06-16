/**
 * Path-A service-tier economics (Grant decision 2026-06-15).
 *
 * ResearchOS is a local-first cloud-SERVICES company, not a storage-by-GB
 * vendor. The billing meter only ever counted live-collab CRDT bytes (a local
 * user is ~0 GB), and selling our-cloud-storage-by-GB contradicts both the dept
 * Model-B pitch (data on your own institution cloud) and the local-first
 * identity. So the GB ladder is replaced by audience+scale SERVICE tiers, and
 * we charge for what the relay uniquely enables.
 *
 * The model primitives:
 *   - A paid tier's COST is dominated by relay activity (writes/sync the cloud
 *     services generate), not storage. ACTIVITY_PER_M_WRITES is the load-bearing
 *     number.
 *   - STORAGE is a-la-carte pass-through at ~1.15x cost, never a profit center,
 *     so it is excluded from the service margin (shown separately as at-cost).
 *   - AI is its own token meter (1.4x solo/lab, 2x dept/inst) handled elsewhere.
 *   - A FREE user gets no cloud produce service, so their cost is a thin relay
 *     footprint (receiving sender-paid snapshots + directory presence) and ~0
 *     storage. That is the whole "no free cloud feature = sustainable" insight.
 *
 * Reads the single sources of truth in assumptions.ts and reuses the Stripe
 * cadence helpers from modeling.ts. Change a constant there and this moves.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import {
  ACTIVITY_PER_M_WRITES,
  BLENDED_PER_GB_MO,
  BUFFER,
  STRIPE_PCT,
} from "./assumptions";
import { stripeMonthlyAmortized, type BillingCadence } from "./modeling";
import {
  AI_TOKEN_PRICE_USD,
  AI_ORG_TOKEN_PRICE_USD,
  AI_MEASURED_BARE_COST_USD_PER_TOKEN,
  STARTER_GRANT_TOKENS,
} from "../billing/ai-config";
import {
  FIXED_MONTHLY_BASE_CENTS,
  AMORTIZED_ANNUAL_CENTS,
} from "../sharing/capacity-shared";

// ── Fixed business costs (Grant 2026-06-16, bake the real LLC overhead in) ──
// The old model used a flat $28 placeholder. The operator console already tracks
// the real fixed costs in capacity-shared.ts, so we source them here rather than
// re-type them: the platform base (Cloudflare Workers $5 + Vercel Pro $20 =
// $25/mo) plus the recurring ANNUAL fees (Apple $99, WI LLC report $25, domain
// $9.99) amortized to ~$11/mo. On top of that the LLC pays operating overhead
// (dev tooling, accounting, software) that the per-user COGS never captures, so
// the dashboard seeds an editable list and the projection charges the total
// every month regardless of scale.

/** Real tracked infra floor, dollars per month, sourced from the operator
 *  console (capacity-shared.ts). Platform base + amortized annual fees. */
export const INFRA_FIXED_MONTHLY =
  (FIXED_MONTHLY_BASE_CENTS + AMORTIZED_ANNUAL_CENTS) / 100;

export interface FixedCostItem {
  label: string;
  /** Dollars per period. */
  amount: number;
  cadence: "monthly" | "yearly";
}

/** Operating overhead the LLC pays to run, ON TOP of the infra floor and
 *  distinct from per-user COGS. Editable estimates the operator tunes; sized to
 *  be realistic rather than zero. */
export const DEFAULT_OPERATING_COSTS: FixedCostItem[] = [
  { label: "Claude Max (dev tooling)", amount: 100, cadence: "monthly" },
  { label: "Accounting / legal / filing", amount: 40, cadence: "monthly" },
  { label: "Misc software + monitoring", amount: 20, cadence: "monthly" },
];

/** Monthly-equivalent total of a fixed-cost list (yearly items divided by 12). */
export function monthlyOf(items: FixedCostItem[]): number {
  return items.reduce(
    (sum, it) => sum + (it.cadence === "yearly" ? it.amount / 12 : it.amount),
    0,
  );
}

/** Total fixed business cost per month = sourced infra floor + operating
 *  overhead. This is the flat monthly the company pays at any scale. */
export function totalFixedMonthly(
  operating: FixedCostItem[] = DEFAULT_OPERATING_COSTS,
): number {
  return INFRA_FIXED_MONTHLY + monthlyOf(operating);
}

// ── AI billing, LOCKED rates (ai-config.ts, Grant 2026-06-14) ───────────────
// AI is a metered token product bought in prepaid packs, separate from the
// service subscription. Rates are locked: bare basis $0.20/1M, real measured
// cost $0.153/1M, individual/lab markup 1.4x ($0.28/1M retail), dept/inst 2x
// ($0.40/1M). The ~0.6x org gap is the same solidarity surplus as storage. We
// fold AI MARGIN (retail minus our real cost) into the paid side, and the
// one-time sign-up grant into the free-side acquisition cost.

/** Retail AI price per 1M tokens, individual + lab (1.4x). About $0.28. */
export const AI_INDIV_RETAIL_PER_M = AI_TOKEN_PRICE_USD * 1_000_000;
/** Retail AI price per 1M tokens, dept + inst (2x). About $0.40. */
export const AI_ORG_RETAIL_PER_M = AI_ORG_TOKEN_PRICE_USD * 1_000_000;
/** Our real measured inference cost per 1M tokens. About $0.153. */
export const AI_REAL_COST_PER_M = AI_MEASURED_BARE_COST_USD_PER_TOKEN * 1_000_000;
/** One-time AI sign-up grant cost to us, in dollars (the measured cost of the
 *  ~1.63M starter tokens). About $0.25. A per-signup acquisition cost, NOT a
 *  recurring monthly free pool. */
export const AI_SIGNUP_GRANT_USD =
  STARTER_GRANT_TOKENS * AI_MEASURED_BARE_COST_USD_PER_TOKEN;

/**
 * Monthly AI margin we keep from one paying user's token usage. They pay the
 * locked markup rate (1.4x individual/lab, 2x dept), we pay the real measured
 * cost. Stripe on a prepaid pack is approximated as a flat percentage since AI
 * is bought in $10+ packs (the fixed fee amortizes to noise). org=true charges
 * the 2x dept rate.
 */
export function aiMarginPerUser(aiTokensM: number, org: boolean): number {
  const retailPerM = org ? AI_ORG_RETAIL_PER_M : AI_INDIV_RETAIL_PER_M;
  const revenue = aiTokensM * retailPerM;
  const cost = aiTokensM * AI_REAL_COST_PER_M;
  const stripe = revenue * STRIPE_PCT;
  return revenue - cost - stripe;
}

/** A-la-carte storage retail markup over blended cost. Covers Stripe + R2 + the
 *  operating buffer with no real surplus, so storage is pass-through, never a
 *  profit center. Grant 2026-06-15 ("1.1x or 1.2x, whatever covers the fees"). */
export const STORAGE_MARKUP = 1.15;

/** Retail price of a-la-carte storage, dollars per GB per month. Near cost. */
export function storageRetailPerGB(): number {
  return BLENDED_PER_GB_MO * (1 + BUFFER) * STORAGE_MARKUP;
}

/** Our bare cost of the relay activity a service generates, dollars per month. */
export function relayCost(writesM: number): number {
  return writesM * ACTIVITY_PER_M_WRITES;
}

export type Audience = "solo" | "lab" | "dept";

/**
 * A service tier. Price buys cloud SERVICES (send, live co-edit, phone capture,
 * push, and for dept the governance layer), not gigabytes. Storage rides
 * a-la-carte on top and is not part of this margin.
 */
export interface ServiceTier {
  id: string;
  name: string;
  audience: Audience;
  /** Monthly-equivalent subscription price. For `lab`/`dept` this is per active
   *  seat (member); the org total scales with headcount. */
  price: number;
  /** Relay write-ops the tier's services generate, millions per month. The cost
   *  driver under Path A (phone capture + live collab + cross-boundary send). */
  relayWritesM: number;
  /** Billing cadence. Solo and lab are 6/12-month only (Grant 2026-06-15). */
  cadence: BillingCadence;
  /** Dept-only flat governance fee per lab per month. Storage stays at lab
   *  parity; this fee (the Commons + compliance + admin layer) is the org
   *  margin that funds the free tier. */
  governanceFeePerLab?: number;
}

export interface ServiceMargin {
  price: number;
  /** Our relay activity cost. */
  relay: number;
  /** Amortized Stripe fee at the tier cadence. */
  stripe: number;
  /** price - relay - stripe. Storage is excluded (pass-through). */
  net: number;
  /** (price - stripe) / relay, the margin over relay cost. Infinity when a tier
   *  generates no relay activity (a pure-presence or governance-only line). */
  marginX: number;
}

/** Per-seat (or per-subscriber) P&L for a service price against its relay load. */
export function serviceMargin(
  price: number,
  relayWritesM: number,
  cadence: BillingCadence,
): ServiceMargin {
  const relay = relayCost(relayWritesM);
  const stripe = stripeMonthlyAmortized(price, cadence);
  const net = price - relay - stripe;
  const marginX = relay > 0 ? (price - stripe) / relay : Number.POSITIVE_INFINITY;
  return { price, relay, stripe, net, marginX };
}

/**
 * Recurring MONTHLY cost to us of one FREE user under Path A.
 *
 * Free users get NO cloud produce feature, so they generate ~0 recurring cost:
 * the local notebook is on their disk, shared-folder workspaces sync through
 * their own cloud, receiving a share is sender-paid, and reads have no R2 egress
 * fee. So the recurring monthly cost is just the relay footprint, which is 0 by
 * default; the dial exists only to stress-test "what if free users turn out
 * chattier than expected." The one-time $0.25 AI sign-up grant is NOT amortized
 * in here (Grant 2026-06-16) -- it is a one-time acquisition cost reported
 * separately via freeBaseAcquisitionOneTime, never folded into the monthly P&L.
 */
export function avgFreeUserCostPathA(freeRelayWritesM: number): number {
  return relayCost(freeRelayWritesM);
}

/** One-time cost to acquire a free base of `freeUsers`, the $0.25 AI sign-up
 *  grant paid once per account. Reported separately from the recurring monthly
 *  net, never amortized into it. */
export function freeBaseAcquisitionOneTime(freeUsers: number): number {
  return freeUsers * AI_SIGNUP_GRANT_USD;
}

/** The three live service tiers (institution is punted for beta). Lab/dept
 *  prices are per active member; dept adds the per-lab governance fee. */
export interface ServiceTiers {
  solo: ServiceTier;
  lab: ServiceTier;
  dept: ServiceTier;
}

/** Adoption assumptions for the at-scale projection. */
export interface AdoptionMix {
  /** Share of ALL users who pay anything. The single most sensitive knob. */
  conversion: number;
  /** Of paying users, the share who are solo individuals. */
  soloShare: number;
  /** Of paying users, the share who are members of a standalone (lab-tier) lab. */
  labShare: number;
  /** Of paying users, the share who are members of a department lab. */
  deptShare: number;
  /** Assumed active members per lab (so a dept lab can amortize its fee). */
  membersPerLab: number;
  /** Relay write footprint of one free user, millions per month. ~0 under Path A
   *  (no cloud produce feature); exists only to stress-test a chattier free user. */
  freeRelayWritesM: number;
  /** Average AI tokens an AI-USING paid user spends per month, in millions. */
  aiTokensPerPaidM: number;
  /** Share of paying users who actually use AI (buy packs). Typically 0.2-0.4;
   *  the rest never touch the metered AI product. Scales the AI margin. */
  aiAdoption: number;
}

/** Normalize the paying-side shares to sum to 1 (they are entered freely). */
function normShares(mix: AdoptionMix): {
  solo: number;
  lab: number;
  dept: number;
} {
  const sum = mix.soloShare + mix.labShare + mix.deptShare || 1;
  return {
    solo: mix.soloShare / sum,
    lab: mix.labShare / sum,
    dept: mix.deptShare / sum,
  };
}

/** Subscription net per paying user, weighted by the paying-side mix (no AI, no
 *  governance fee). Dept seats are at lab parity. */
export function blendedSubNet(tiers: ServiceTiers, mix: AdoptionMix): number {
  const s = normShares(mix);
  const soloNet = serviceMargin(
    tiers.solo.price,
    tiers.solo.relayWritesM,
    tiers.solo.cadence,
  ).net;
  const labSeatNet = serviceMargin(
    tiers.lab.price,
    tiers.lab.relayWritesM,
    tiers.lab.cadence,
  ).net;
  const deptSeatNet = serviceMargin(
    tiers.dept.price,
    tiers.dept.relayWritesM,
    tiers.dept.cadence,
  ).net;
  return s.solo * soloNet + s.lab * labSeatNet + s.dept * deptSeatNet;
}

/** Governance-fee contribution per paying user. Only dept members carry it, the
 *  flat per-lab fee amortized across the lab. */
export function blendedGovPerPaid(tiers: ServiceTiers, mix: AdoptionMix): number {
  const s = normShares(mix);
  const govPerMember =
    (tiers.dept.governanceFeePerLab ?? 0) / Math.max(1, mix.membersPerLab);
  return s.dept * govPerMember;
}

/** AI margin per paying user, weighted by mix and scaled by AI adoption (only a
 *  fraction of paid users buy AI). Dept members bill at the 2x org rate, solo +
 *  lab at the 1.4x individual rate. */
export function blendedAiMargin(tiers: ServiceTiers, mix: AdoptionMix): number {
  const s = normShares(mix);
  const indiv = aiMarginPerUser(mix.aiTokensPerPaidM, false);
  const org = aiMarginPerUser(mix.aiTokensPerPaidM, true);
  return mix.aiAdoption * ((s.solo + s.lab) * indiv + s.dept * org);
}

/** Total net we keep per paying user = subscription + AI margin + governance. */
export function blendedPaidNet(tiers: ServiceTiers, mix: AdoptionMix): number {
  return (
    blendedSubNet(tiers, mix) +
    blendedAiMargin(tiers, mix) +
    blendedGovPerPaid(tiers, mix)
  );
}

export interface ScalePoint {
  users: number;
  /** Subscription net contribution. */
  sub: number;
  /** AI margin contribution. */
  ai: number;
  /** Governance-fee contribution. */
  gov: number;
  /** sub + ai + gov, the positive side of the P&L. */
  revenue: number;
  /** Free-user recurring relay cost (~0 under Path A). This IS the whole
   *  recurring free-base cost; the AI grant is one-time, reported separately. */
  freeCost: number;
  /** Fixed infra floor. */
  fixed: number;
  /** freeCost + fixed, the recurring monthly expense. */
  expense: number;
  /** revenue - expense, the recurring monthly net. */
  net: number;
  /** One-time $0.25 AI grant to acquire the current free base. NOT in net. */
  freeAcqOneTime: number;
}

/** Profit vs expense at a given total user count, broken into revenue sources.
 *  The free base costs ~$0/mo recurring; acquiring it is a one-time cost tracked
 *  in freeAcqOneTime and deliberately kept out of the monthly net. fixedMonthly
 *  is the flat business cost (infra floor + operating overhead) charged every
 *  month regardless of scale; defaults to the sourced + seeded total. */
export function projectAtScale(
  users: number,
  tiers: ServiceTiers,
  mix: AdoptionMix,
  fixedMonthly: number = totalFixedMonthly(),
): ScalePoint {
  const free = users * (1 - mix.conversion);
  const paid = users * mix.conversion;
  const sub = paid * blendedSubNet(tiers, mix);
  const ai = paid * blendedAiMargin(tiers, mix);
  const gov = paid * blendedGovPerPaid(tiers, mix);
  const revenue = sub + ai + gov;
  const freeCost = free * relayCost(mix.freeRelayWritesM);
  const fixed = fixedMonthly;
  const expense = freeCost + fixed;
  return {
    users,
    sub,
    ai,
    gov,
    revenue,
    freeCost,
    fixed,
    expense,
    net: revenue - expense,
    freeAcqOneTime: freeBaseAcquisitionOneTime(free),
  };
}

/**
 * Asymptotic break-even conversion (as the user base grows the fixed infra floor
 * washes out). At net=0, conversion = freeCost / (paidNet + freeCost). This is
 * the headline number under Path A, and because the free base is cheap it lands
 * far below the old GB-model break-even.
 */
export function breakEvenConversion(
  tiers: ServiceTiers,
  mix: AdoptionMix,
): number {
  const F = avgFreeUserCostPathA(mix.freeRelayWritesM);
  const R = blendedPaidNet(tiers, mix);
  if (R + F <= 0) return 1;
  return Math.min(1, Math.max(0, F / (R + F)));
}

/**
 * Total user count at which the monthly net crosses zero (the business becomes
 * profitable), given the tiers, mix, and fixed monthly cost. Each additional
 * user contributes, on average, `conversion * paidNet - (1 - conversion) *
 * freeCost`; dividing the flat fixed cost by that per-user contribution gives the
 * count needed to cover it. Returns Infinity when the per-user contribution is
 * <= 0 (the business never breaks even at this conversion, no scale fixes it).
 */
export function breakEvenUsers(
  tiers: ServiceTiers,
  mix: AdoptionMix,
  fixedMonthly: number = totalFixedMonthly(),
): number {
  const perUser =
    mix.conversion * blendedPaidNet(tiers, mix) -
    (1 - mix.conversion) * avgFreeUserCostPathA(mix.freeRelayWritesM);
  if (perUser <= 0) return Number.POSITIVE_INFINITY;
  return fixedMonthly / perUser;
}

/** How many free users one paying user can carry at break-even (the inverse
 *  intuition for the same number). Infinity when free users are effectively free
 *  (relay 0 and grant not amortized), which is Path A in the limit. */
export function freeUsersPerPayer(tiers: ServiceTiers, mix: AdoptionMix): number {
  const F = avgFreeUserCostPathA(mix.freeRelayWritesM);
  if (F <= 0) return Number.POSITIVE_INFINITY;
  return blendedPaidNet(tiers, mix) / F;
}
