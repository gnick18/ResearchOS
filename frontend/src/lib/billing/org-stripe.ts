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
// webhook can attribute events. Stripe Tax (automatic_tax) is always on (decided
// 2026-06-14): it computes $0 where we are not registered or the product is not
// taxable, and monitors economic-nexus thresholds, so it is safe to run on every
// org invoice/subscription. Everything runs against Stripe TEST keys until the
// live-key flip. See docs/proposals/2026-06-13-org-tier-billing-cascade.md.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type Stripe from "stripe";

import { ORG_INVOICE_NET_DAYS } from "./config";
import { getStripe } from "./stripe";
import { priceForMethod, stripeMethodsFor, type PayClass } from "./processing-fee";
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
  /** The CARD list price (cents) the plan derived to. The actual charge depends
   *  on the pay class: card pays the list, a bank debit gets the discount. */
  monthlyCents: number;
  /** Collection: an emailed invoice (net terms) or an auto-charge on file. */
  method: OrgBillingMethod;
  /** Pay class: card (list price) or bank debit (discounted price). */
  payClass: PayClass;
  /** Optional PO number to stamp on the invoice (invoice method). */
  poNumber?: string | null;
  /** Origin for Checkout return URLs (automatic first-time setup). */
  returnOrigin: string;
}): Promise<OrgBillingSetupResult> {
  const { tier, entityId, info, planInputs, monthlyCents, method, payClass } = args;
  const stripe = getStripe();

  // The actual charged amount: card pays the list, a bank debit gets the discount
  // reflecting the lower processing fee. International only raises the CARD list
  // (an international card costs us more); the bank price stays low.
  const international = planInputs.international === 1;
  const chargeCents = priceForMethod(monthlyCents, payClass, international);

  // Snapshot the PRIOR row BEFORE setOrgPlan overwrites method/payClass. The
  // pay-method-switch check below must compare against the previous choice; if we
  // read after the write it always sees the new values and never opens a fresh
  // Checkout, leaving a charge_automatically subscription with no card on file.
  // setOrgPlan does not touch the Stripe ids, so this snapshot is also correct for
  // the in-place-update path.
  const existing = await getOrgBilling(tier, entityId);

  // Store the charged amount as the row's monthly_cents (what they actually pay).
  await setOrgPlan(tier, entityId, planInputs, chargeCents, method, payClass);

  if (monthlyCents <= 0) {
    await cancelOrgSubscription(tier, entityId);
    await setOrgSubscription(tier, entityId, null, null, "inactive");
    return { status: "inactive" };
  }

  const customerId = await ensureOrgCustomer(tier, entityId, info);

  // A standalone monthly Price reflecting the charged amount, referenced by id by
  // every path (the subscription-item update type does not accept inline
  // product_data, so one Price object is the portable way to set the amount).
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: chargeCents,
    recurring: { interval: "month" },
    product_data: { name: `${TIER_PRODUCT_LABEL[tier]} (${info.name})` },
  });
  const metadata: Stripe.MetadataParam = { orgTier: tier, orgId: entityId };
  if (args.poNumber) metadata.poNumber = args.poNumber;
  // Stripe Tax on every org invoice/subscription. Safe always-on: $0 where we are
  // not registered or the product is not taxable (e.g. SaaS in WI), and exempt
  // universities still pay no tax once their exemption is on the Stripe customer.
  const tax = { automatic_tax: { enabled: true } };
  // The discount is honest because it is enforced: a bank (discounted) price is
  // only ever payable by a bank debit, a card price only by a card.
  const allowedMethods = stripeMethodsFor(payClass);

  const hasSub = !!(existing?.stripeSubscriptionId && existing.stripeItemId);
  // We can update in place when a subscription exists, EXCEPT when the saved
  // payment instrument cannot satisfy the new choice: any automatic setup whose
  // collection or pay class changed needs a fresh Checkout to collect the right
  // instrument (a card cannot be charged as a bank debit, or vice versa). An
  // invoice never has a saved instrument, so it always updates in place.
  const needsFreshCheckout =
    method === "automatic" &&
    (existing?.method !== "automatic" || existing?.payClass !== payClass);
  if (hasSub && !needsFreshCheckout) {
    const collection =
      method === "invoice"
        ? {
            collection_method: "send_invoice" as const,
            days_until_due: ORG_INVOICE_NET_DAYS,
            payment_settings: { payment_method_types: allowedMethods },
          }
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

  // Fresh setup. Invoice: create the subscription directly (no saved instrument),
  // restricting the hosted invoice to the chosen pay class so a bank-discounted
  // invoice can only be paid by a bank debit.
  if (method === "invoice") {
    const created = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      collection_method: "send_invoice",
      days_until_due: ORG_INVOICE_NET_DAYS,
      payment_settings: { payment_method_types: allowedMethods },
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

  // Automatic setup. Cancel any prior subscription so the org is never billed
  // twice, then collect the chosen instrument via Checkout (restricted to the
  // pay class). The subscription is created on completion and the webhook marks
  // it active. Stripe presents only the methods in allowedMethods that are
  // eligible for this customer and currency (so international bank debits appear
  // where the Dashboard + billing currency support them).
  if (existing?.stripeSubscriptionId) {
    await cancelOrgSubscription(tier, entityId);
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price.id, quantity: 1 }],
    payment_method_types: allowedMethods,
    billing_address_collection: "required",
    ...tax,
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
