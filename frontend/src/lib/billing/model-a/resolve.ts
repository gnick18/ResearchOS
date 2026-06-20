// Model A billing, plan resolution for the cloud-ledger engine (step 2).
//
// Maps a billing owner to the Model-A plan the accrual roll-up and the UI should
// use. The cloud accrued-ledger model (base fee + metered usage, charged to a card
// when it crosses ~$5) covers SOLO and LAB, the per-owner billing_subscriptions
// path. Departments and institutions bill on the separate org_billing track (a
// net-30 procurement invoice, not a card), so they are not resolved here; their
// Model-A numbers migrate within the org-billing system.
//
// The mapper is pure (a SubscriptionRecord in, a Model-A plan id out) so it is
// unit-tested, and it bridges BOTH the legacy flat-plan catalog (plus/pro ->
// solo, lab_plus/lab_pro -> lab, by audience) and the new direct Model-A ids the
// Model-A checkout will set.
//
// Comped tiers (Grant 2026-06-19): when the real subscription resolves to free
// but an operator has issued a comped gift tier (solo / lab / dept), the comped
// tier is treated as the effective Model-A plan. A real paid plan always wins
// (a comp never downgrades). A grants-layer error defaults to free so a failure
// never grants paid entitlement. AI tokens are NOT comped here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getSubscription, type SubscriptionRecord } from "../db";
import { getActiveCompedTier, type GiftTier } from "../grants";
import { ensureLabSchema, resolveBillingOwner } from "../lab";
import { getPlan } from "../plans";
import type { ModelAPlanId } from "./pricing";

/** Maps a comped gift tier to its equivalent Model-A plan id. The mapping is
 *  1-to-1 because the GiftTier values match the ModelAPlanId values exactly.
 *  Kept explicit so a future rename is a compile error, not a silent mismatch. */
function giftTierToModelAPlanId(tier: GiftTier): ModelAPlanId {
  if (tier === "dept") return "dept";
  if (tier === "lab") return "lab";
  return "solo";
}

/** The Model-A plan a subscription resolves to. Free unless the subscription is
 *  active and on a paid tier. */
export function modelAPlanForSubscription(
  sub: SubscriptionRecord | null,
): ModelAPlanId {
  if (!sub || sub.status !== "active") return "free";

  // Direct Model-A ids, set by the Model-A checkout. (dept is included for
  // completeness but the org track, not this engine, drives dept billing.)
  if (sub.planId === "solo" || sub.planId === "lab" || sub.planId === "dept") {
    return sub.planId;
  }

  // Bridge from the legacy flat-plan catalog: any active paid lab plan is a lab,
  // any active paid individual plan is a solo, everything else is free.
  const plan = getPlan(sub.planId);
  if (!plan || plan.priceCents <= 0) return "free";
  return plan.audience === "lab" ? "lab" : "solo";
}

/**
 * The effective Model-A plan id for an owner. The real paid subscription wins
 * when active. When the subscription resolves to free, an active comped tier
 * (from getActiveCompedTier) is used instead. Falls back to free when there is
 * no subscription and no comp. A grants error is caught and treated as no comp
 * so a failure in the grants layer never opens a paid gate.
 *
 * This is the single resolution point that all produce-side gates should call
 * so comped-tier entitlement is enforced consistently.
 */
export async function getEffectiveModelAPlanId(ownerKey: string): Promise<ModelAPlanId> {
  const sub = await getSubscription(ownerKey);
  const fromSub = modelAPlanForSubscription(sub);
  // A real paid plan always wins: the comp must never downgrade it.
  if (fromSub !== "free") return fromSub;
  // Real plan is free (or no row). Check for an operator-issued comped tier.
  const compedTier = await getActiveCompedTier(ownerKey).catch(() => null);
  if (!compedTier) return "free";
  return giftTierToModelAPlanId(compedTier);
}

/** The Model-A plan id for a billing owner, read from their subscription or
 *  active comped tier. Callers that need the pure subscription mapping (e.g.
 *  the accrual cron that should only charge real subscribers) should call
 *  modelAPlanForSubscription directly instead. */
export async function resolveModelAPlanId(ownerKey: string): Promise<ModelAPlanId> {
  return getEffectiveModelAPlanId(ownerKey);
}

/**
 * Whether an owner may use the PAID produce side (send, live co-edit, app
 * pairing). True if they are on a paid plan, OR are a free member resolved to a
 * paid lab (the PI pays, so the member produces under the lab), OR the billing
 * owner holds an active comped tier. Used at the produce paywalls to gate a free
 * user once billing is live; callers should only enforce it when
 * isBillingEnabled() (it is meaningless during the free beta).
 */
export async function isProduceEntitled(ownerKey: string): Promise<boolean> {
  await ensureLabSchema();
  // A free member of an active lab resolves to the PI's key; a solo resolves to
  // self. Then the resolved owner's effective plan decides entitlement.
  const billingOwner = await resolveBillingOwner(ownerKey);
  return (await getEffectiveModelAPlanId(billingOwner)) !== "free";
}
