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
} from "./assumptions";
import {
  stripeMonthlyAmortized,
  FIXED_BASE_MONTHLY,
  type BillingCadence,
} from "./modeling";

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
 * Average monthly cost to us of one FREE user under Path A. Free users get no
 * cloud produce feature, so the only cost is a thin relay footprint (receiving
 * sender-paid snapshots, directory presence) and effectively no storage.
 * freeRelayWritesM is small by design, which is the point.
 */
export function avgFreeUserCostPathA(freeRelayWritesM: number): number {
  return relayCost(freeRelayWritesM);
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
  /** Relay write footprint of one free user, millions per month. Tiny under
   *  Path A because free users have no cloud produce features. */
  freeRelayWritesM: number;
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

/** Blended net we keep per paying user, weighted by the paying-side mix. Dept
 *  members carry their per-lab governance fee amortized across the lab. */
export function blendedPaidNet(tiers: ServiceTiers, mix: AdoptionMix): number {
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
  // Dept labs pay lab-parity per seat PLUS a flat governance fee per lab,
  // amortized across the members so it reads as a per-paying-user contribution.
  const govPerMember =
    (tiers.dept.governanceFeePerLab ?? 0) / Math.max(1, mix.membersPerLab);
  const deptSeatNet = labSeatNet + govPerMember;
  return s.solo * soloNet + s.lab * labSeatNet + s.dept * deptSeatNet;
}

export interface ScalePoint {
  users: number;
  revenue: number;
  expense: number;
  net: number;
}

/** Profit vs expense at a given total user count, driven by the tiers + mix. */
export function projectAtScale(
  users: number,
  tiers: ServiceTiers,
  mix: AdoptionMix,
): ScalePoint {
  const free = users * (1 - mix.conversion);
  const paid = users * mix.conversion;
  const revenue = paid * blendedPaidNet(tiers, mix);
  const expense =
    free * avgFreeUserCostPathA(mix.freeRelayWritesM) + FIXED_BASE_MONTHLY;
  return { users, revenue, expense, net: revenue - expense };
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

/** How many free users one paying user can carry at break-even (the inverse
 *  intuition for the same number). */
export function freeUsersPerPayer(tiers: ServiceTiers, mix: AdoptionMix): number {
  const F = avgFreeUserCostPathA(mix.freeRelayWritesM);
  if (F <= 0) return Number.POSITIVE_INFINITY;
  return blendedPaidNet(tiers, mix) / F;
}
