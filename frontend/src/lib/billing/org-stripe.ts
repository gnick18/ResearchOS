// Phase 3 org billing: the Stripe orchestration for department + institution
// subscriptions.
//
// An org picks how it pays (our pricing research found both buyer types):
//
//   invoice    - a procurement office that needs a purchase order. We create the
//                subscription server-side with collection_method send_invoice and
//                net terms; Stripe emails a hosted invoice payable by ACH or card.
//                No payment method is collected up front.
//   automatic  - a smaller department or a PI fronting the cost, happy to put it
//                on a card or bank account and have it charged each cycle. This
//                needs a saved payment method, so a first-time setup goes through
//                a Stripe Checkout Session (card + us_bank_account); the webhook
//                marks it active once they finish. Later plan changes update the
//                price in place.
//
// Either way the price is the derived monthly rate, re-derived from the live plan
// so a change takes effect next cycle. metadata carries { orgTier, orgId } so the
// webhook can attribute events. Sales tax is a seam (isOrgTaxEnabled, off until
// the Wisconsin determination). Everything runs against Stripe TEST keys until
// the live-key flip. See docs/proposals/2026-06-13-org-tier-billing-cascade.md.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type Stripe from "stripe";

import { isOrgTaxEnabled, ORG_INVOICE_NET_DAYS } from "./config";
import { getStripe } from "./stripe";
import {
  getOrgBilling,
  setOrgCustomer,
  setOrgPlan,
  setOrgSubscription,
  type OrgBillingMethod,
  type OrgTier,
} from "./org-billing";

/** A human label + contact for the entity, used to name the Stripe Customer and
 *  address the invoice or receipt. The email is the org admin's. */
export interface OrgCustomerInfo {
  name: string;
  email: string;
}

/**
 * Ensures a Stripe Customer exists for an org entity and returns its id. Reuses
 * the stored id if present so an entity keeps one customer across cycles. The
 * customer is keyed in metadata by { orgTier, orgId } for traceability.
 */
export async function ensureOrgCustomer(
  tier: OrgTier,
  entityId: string,
  info: OrgCustomerInfo,
): Promise<string> {
  const existing = await getOrgBilling(tier, entityId);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await getStripe().customers.create({
    name: info.name,
    email: info.email,
    metadata: { orgTier: tier, orgId: entityId },
  });
  await setOrgCustomer(tier, entityId, customer.id);
  return customer.id;
}

const TIER_PRODUCT_LABEL: Record<OrgTier, string> = {
  department: "ResearchOS Department plan",
  institution: "ResearchOS Institution plan",
};

export interface OrgBillingSetupResult {
  /** active = billing is on; pending_checkout = the admin must finish Stripe
   *  Checkout at `url` to save a payment method; inactive = no billable plan. */
  status: "inactive" | "active" | "pending_checkout";
  /** Present only for pending_checkout: the Stripe Checkout URL to redirect to. */
  url?: string;
}

/**
 * Sets up (or updates) an org's billing for the built plan and chosen method.
 * Stores the plan + method first so the row reflects the admin's choice even if
 * the rate is zero or Stripe later errors. A zero rate cancels any subscription.
 *
 * Returns active when the subscription is live, or pending_checkout with a URL
 * when an automatic first-time setup needs the admin to add a card or bank.
 */
export async function setupOrgBilling(args: {
  tier: OrgTier;
  entityId: string;
  info: OrgCustomerInfo;
  planInputs: Record<string, number>;
  monthlyCents: number;
  method: OrgBillingMethod;
  /** Optional PO number to stamp on the invoice (invoice method). */
  poNumber?: string | null;
  /** Origin for Checkout return URLs (automatic first-time setup). */
  returnOrigin: string;
}): Promise<OrgBillingSetupResult> {
  const { tier, entityId, info, planInputs, monthlyCents, method } = args;
  const stripe = getStripe();

  await setOrgPlan(tier, entityId, planInputs, monthlyCents, method);

  if (monthlyCents <= 0) {
    await cancelOrgSubscription(tier, entityId);
    await setOrgSubscription(tier, entityId, null, null, "inactive");
    return { status: "inactive" };
  }

  const customerId = await ensureOrgCustomer(tier, entityId, info);
  const existing = await getOrgBilling(tier, entityId);

  // A standalone monthly Price reflecting the derived rate, referenced by id by
  // every path (the subscription-item update type does not accept inline
  // product_data, so one Price object is the portable way to set the amount).
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: Math.round(monthlyCents),
    recurring: { interval: "month" },
    product_data: { name: `${TIER_PRODUCT_LABEL[tier]} (${info.name})` },
  });
  const metadata: Stripe.MetadataParam = { orgTier: tier, orgId: entityId };
  if (args.poNumber) metadata.poNumber = args.poNumber;
  const tax = isOrgTaxEnabled() ? { automatic_tax: { enabled: true } } : {};

  const hasSub = !!(existing?.stripeSubscriptionId && existing.stripeItemId);
  // We can update the price in place when a subscription exists, EXCEPT when
  // switching INTO automatic from invoice, which needs a payment method we have
  // to collect via Checkout. Switching automatic -> invoice is fine in place
  // (send_invoice needs no saved card).
  const switchingIntoAutomatic = method === "automatic" && existing?.method !== "automatic";
  if (hasSub && !switchingIntoAutomatic) {
    const collection =
      method === "invoice"
        ? { collection_method: "send_invoice" as const, days_until_due: ORG_INVOICE_NET_DAYS }
        : { collection_method: "charge_automatically" as const };
    const updated = await stripe.subscriptions.update(existing!.stripeSubscriptionId!, {
      items: [{ id: existing!.stripeItemId!, price: price.id }],
      metadata,
      ...collection,
      ...tax,
      proration_behavior: "none",
    });
    await setOrgSubscription(
      tier,
      entityId,
      updated.id,
      updated.items.data[0]?.id ?? null,
      "active",
    );
    return { status: "active" };
  }

  // Fresh setup. Invoice: create the subscription directly (no payment method).
  if (method === "invoice") {
    const created = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      collection_method: "send_invoice",
      days_until_due: ORG_INVOICE_NET_DAYS,
      metadata,
      ...tax,
    });
    await setOrgSubscription(
      tier,
      entityId,
      created.id,
      created.items.data[0]?.id ?? null,
      "active",
    );
    return { status: "active" };
  }

  // Automatic first-time setup. Cancel any prior (invoice) subscription so the
  // org is never billed twice, then collect a card or bank via Checkout. The
  // subscription is created on completion and the webhook marks it active.
  if (existing?.stripeSubscriptionId) {
    await cancelOrgSubscription(tier, entityId);
  }
  // Omit payment_method_types so Stripe presents every recurring-capable method
  // eligible for this customer and currency (card everywhere, plus local bank
  // debits like ACH / SEPA / BACS where the Stripe Dashboard enables them). This
  // lets international accounts pay without a code change per region; enabling a
  // new method (or a new billing currency) is a Stripe Dashboard action.
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    subscription_data: { metadata },
    success_url: `${args.returnOrigin}/${tier === "institution" ? "institution" : "department"}?billing=success`,
    cancel_url: `${args.returnOrigin}/${tier === "institution" ? "institution" : "department"}?billing=cancel`,
  });
  await setOrgSubscription(tier, entityId, null, null, "pending_checkout");
  return { status: "pending_checkout", url: session.url ?? undefined };
}

/** Cancels an org subscription (an admin who drops back to no plan). Marks the
 *  row canceled. Safe to call when there is no subscription. */
export async function cancelOrgSubscription(
  tier: OrgTier,
  entityId: string,
): Promise<void> {
  const existing = await getOrgBilling(tier, entityId);
  if (existing?.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.cancel(existing.stripeSubscriptionId);
    } catch {
      // Already gone on Stripe's side; fall through to mark canceled locally.
    }
  }
  await setOrgSubscription(
    tier,
    entityId,
    existing?.stripeSubscriptionId ?? null,
    existing?.stripeItemId ?? null,
    "canceled",
  );
}
