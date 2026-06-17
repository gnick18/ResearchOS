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
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getSubscription, type SubscriptionRecord } from "../db";
import { getPlan } from "../plans";
import type { ModelAPlanId } from "./pricing";

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

/** The Model-A plan id for a billing owner, read from their subscription. */
export async function resolveModelAPlanId(ownerKey: string): Promise<ModelAPlanId> {
  return modelAPlanForSubscription(await getSubscription(ownerKey));
}
