// Model A billing: pure pricing core (no server imports).
//
// ResearchOS is a local-first cloud-SERVICES business, pay-for-what-you-use. A
// paid plan is a small base fee plus the cloud USAGE you actually run at a markup,
// accrued to a ledger and charged when the balance crosses a threshold (Step 3/4).
// This module is the pure math: the plan shapes + turning a payer's pooled period
// usage into a marked-up charge in cents. It reuses the projection calculator's
// rate primitives (service-model.ts) so the engine and the projections never drift.
//
// Canonical pricing: docs/branding/PRICING.md. Build plan:
// docs/handoffs/2026-06-16-model-a-billing-engine-build.md.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  relayCost,
  storageRetailPerGB,
  hostedAssetMonthlyCost,
  type Audience,
} from "@/lib/pricing/service-model";

/** The Model-A plan ids. Free is the network audience (receive-only, no produce
 *  features, ~$0 recurring). Solo/Lab/Dept are the paid service tiers. */
export type ModelAPlanId = "free" | "solo" | "lab" | "dept";

export interface ModelAPlan {
  id: ModelAPlanId;
  name: string;
  /** "free" is the network audience; the others map to the calculator's Audience. */
  audience: Audience | "free";
  /** Monthly base fee in cents. Charged PER LAB for lab/dept, once for solo, never
   *  for free. The "we show a monthly price" part of the bill. */
  baseFeeCents: number;
  /** Multiplier on our bare relay/compute cost for metered usage. Storage and
   *  hosted assets do NOT use this; they bill at the flat 1.15x near-cost rate. */
  usageMarkup: number;
  /** Whether the tier unlocks the paid produce side (send, live co-edit, phone
   *  capture, push). Free is receive-only, so it accrues no usage charge. */
  produce: boolean;
}

/** The Model-A catalog (working config 2026-06-16, final after the Grant+Emile
 *  meeting). Dollar figures are easy to retune here without touching the math. */
export const MODEL_A_PLANS: Record<ModelAPlanId, ModelAPlan> = {
  free: { id: "free", name: "Free", audience: "free", baseFeeCents: 0, usageMarkup: 0, produce: false },
  solo: { id: "solo", name: "Solo", audience: "solo", baseFeeCents: 300, usageMarkup: 5, produce: true },
  lab: { id: "lab", name: "Lab", audience: "lab", baseFeeCents: 4000, usageMarkup: 7, produce: true },
  // Department is the INSTITUTIONAL VOLUME tier (Grant 2026-06-16): cheaper PER LAB
  // than a standalone lab on both base ($35 vs $40) and markup (6x vs 7x), because
  // landing a department brings many labs at once and is our distribution win. The
  // governance layer (Commons, cross-lab compliance, one consolidated invoice) is
  // included value, NOT a premium. So we reward depts, never tax them.
  dept: { id: "dept", name: "Department", audience: "dept", baseFeeCents: 3500, usageMarkup: 6, produce: true },
};

/** Run the card on file once a payer's accrued balance crosses this (~$5), or at
 *  cancellation. Sized to keep Stripe's $0.30/charge fee a small share of each run. */
export const ACCRUAL_CHARGE_THRESHOLD_CENTS = 500;

export function getModelAPlan(id: string | null | undefined): ModelAPlan {
  if (id && id in MODEL_A_PLANS) return MODEL_A_PLANS[id as ModelAPlanId];
  return MODEL_A_PLANS.free; // unknown/missing never grants paid room
}

/** A payer's pooled usage for one billing period. For lab/dept this is the POOL
 *  (PI plus active members) from getLabPoolWrites / getLabPoolUsage, plus the
 *  lab's hosted-asset bytes. For solo it is just their own. */
export interface UsagePeriodInput {
  /** Relay write-ops this period (collab_owner_writes pool sum). */
  writes: number;
  /** Stored bytes right now (collab_doc_sizes pool sum). Decimal GB (1e9). */
  storageBytes: number;
  /** Hosted companion-site asset bytes (lab_hosted_assets). Decimal GB. */
  hostedBytes: number;
  /** Number of labs the base fee covers (lab/dept). Defaults to 1; ignored for
   *  solo/free. */
  labCount?: number;
}

export interface PeriodCharge {
  /** Base fee for the period (times lab count for lab/dept, 0 for free). */
  baseCents: number;
  /** Marked-up relay/compute usage (0 for free, which has no produce side). */
  usageCents: number;
  /** A-la-carte storage at the flat 1.15x near-cost rate. */
  storageCents: number;
  /** Hosted companion-site assets at the same 1.15x rate. */
  hostedCents: number;
  /** Sum of the above, the cents to accrue to the payer's ledger this period. */
  totalCents: number;
}

const writesToMillions = (writes: number) => Math.max(0, writes) / 1_000_000;
const bytesToGb = (bytes: number) => Math.max(0, bytes) / 1e9;
const usdToCents = (usd: number) => Math.round(usd * 100);

/**
 * The cents to accrue for one payer for one billing period under Model A. Pure:
 * usage in, charge out. Callers pass the pooled usage and the plan; the ledger
 * (Step 3) persists the result and the charge job (Step 4) runs the card.
 */
export function periodCharge(plan: ModelAPlan, usage: UsagePeriodInput): PeriodCharge {
  const perLab = plan.audience === "lab" || plan.audience === "dept";
  const labs = perLab ? Math.max(1, Math.floor(usage.labCount ?? 1)) : 1;

  const baseCents = plan.audience === "free" ? 0 : plan.baseFeeCents * labs;

  // Metered relay/compute usage at the tier markup. Bare cost from the same
  // primitive the projection model uses, so a $ of usage here matches a $ there.
  const usageCents = plan.produce
    ? usdToCents(relayCost(writesToMillions(usage.writes)) * plan.usageMarkup)
    : 0;

  // Storage + hosted ride at the flat 1.15x near-cost rate regardless of tier
  // (storageRetailPerGB / hostedAssetMonthlyCost already bake in the markup).
  const storageCents = usdToCents(bytesToGb(usage.storageBytes) * storageRetailPerGB());
  const hostedCents = usdToCents(hostedAssetMonthlyCost(usage.hostedBytes));

  const totalCents = baseCents + usageCents + storageCents + hostedCents;
  return { baseCents, usageCents, storageCents, hostedCents, totalCents };
}

/** Whether an accrued balance is due to be charged (>= the $5 threshold). The
 *  charge job (Step 4) also forces a run at cancellation regardless of this. */
export function isChargeable(accruedCents: number): boolean {
  return accruedCents >= ACCRUAL_CHARGE_THRESHOLD_CENTS;
}
