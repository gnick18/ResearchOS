// Phase 3 org billing: the Stripe orchestration for department + institution
// procurement subscriptions.
//
// Unlike individuals and labs (hosted checkout, auto-charged card), an org pays
// procurement-style: a recurring subscription billed by a SENT INVOICE with net
// terms (PO number, ACH or card). So there is no Checkout Session; we create the
// Customer and the subscription server-side and Stripe emails the invoice.
//
//   1. ensureOrgCustomer  - one Stripe Customer per entity (dept_id /
//      institution_id), reused across cycles, the customer id stored on the row.
//   2. provisionOrgSubscription - create or update a recurring subscription whose
//      price is the derived monthly rate (an inline price_data, re-derived from
//      the live plan), collection_method send_invoice, days_until_due net terms.
//      metadata carries { orgTier, orgId } so the webhook can attribute events.
//
// Sales tax is a seam: automatic_tax is applied only when isOrgTaxEnabled(),
// which stays OFF until Grant's Wisconsin determination lands.
//
// Everything here runs against Stripe TEST keys until the live-key flip (the lab
// go-live gate). The routes that call this are additionally dark unless
// BILLING_ENABLED. See docs/proposals/2026-06-13-org-tier-billing-cascade.md.
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
  type OrgTier,
} from "./org-billing";

/** A human label + contact for the entity, used to name the Stripe Customer and
 *  address the invoice. The email is the org admin's (where Stripe sends it). */
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

/**
 * Creates or updates the recurring procurement subscription for an org entity so
 * its monthly price reflects the derived rate. Stores the plan inputs + rate and
 * the resulting Stripe ids. Returns the subscription.
 *
 * A monthlyCents of 0 (a plan that derives to nothing billable) does not create a
 * Stripe subscription; the caller treats that as the free state.
 */
export async function provisionOrgSubscription(args: {
  tier: OrgTier;
  entityId: string;
  info: OrgCustomerInfo;
  planInputs: Record<string, number>;
  monthlyCents: number;
  /** Optional PO number to stamp on the invoice. */
  poNumber?: string | null;
}): Promise<Stripe.Subscription | null> {
  const { tier, entityId, info, planInputs, monthlyCents } = args;
  const stripe = getStripe();

  // Persist the built plan first so the row reflects the admin's choice even if
  // the rate is zero (no Stripe object) or Stripe later errors.
  await setOrgPlan(tier, entityId, planInputs, monthlyCents);

  if (monthlyCents <= 0) {
    await setOrgSubscription(tier, entityId, null, null, "inactive");
    return null;
  }

  const customerId = await ensureOrgCustomer(tier, entityId, info);
  const existing = await getOrgBilling(tier, entityId);

  // A standalone monthly Price reflecting the derived rate, referenced by id by
  // both the create and update paths (the update item type does not accept inline
  // product_data, so one Price object is the portable way to set the amount).
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: Math.round(monthlyCents),
    recurring: { interval: "month" },
    product_data: { name: `${TIER_PRODUCT_LABEL[tier]} (${info.name})` },
  });
  const metadata: Stripe.MetadataParam = { orgTier: tier, orgId: entityId };
  if (args.poNumber) metadata.poNumber = args.poNumber;

  // Update the existing subscription item's price when one exists, so a plan
  // change takes effect next cycle without churning the subscription.
  if (existing?.stripeSubscriptionId && existing.stripeItemId) {
    const updated = await stripe.subscriptions.update(
      existing.stripeSubscriptionId,
      {
        items: [{ id: existing.stripeItemId, price: price.id }],
        metadata,
        ...(isOrgTaxEnabled() ? { automatic_tax: { enabled: true } } : {}),
        proration_behavior: "none",
      },
    );
    await setOrgSubscription(
      tier,
      entityId,
      updated.id,
      updated.items.data[0]?.id ?? null,
      "active",
    );
    return updated;
  }

  const created = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: price.id }],
    collection_method: "send_invoice",
    days_until_due: ORG_INVOICE_NET_DAYS,
    metadata,
    ...(isOrgTaxEnabled() ? { automatic_tax: { enabled: true } } : {}),
  });
  await setOrgSubscription(
    tier,
    entityId,
    created.id,
    created.items.data[0]?.id ?? null,
    "active",
  );
  return created;
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
