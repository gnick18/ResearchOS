// Model A billing, the Stripe glue for card-on-file + off-session charging.
//
// Two pieces, both thin wrappers over the shared Stripe client:
//   createCardSetupCheckout: a hosted Checkout in "setup" mode that saves a card
//     to a customer (no charge), the front door of a paid Model-A plan. The
//     webhook stores the resulting customer + payment method and activates the
//     plan on completion.
//   stripeOffSessionCharger: the production OffSessionCharger for the charge run,
//     creating + confirming a PaymentIntent off-session against the saved card.
//
// These are the only Stripe API calls in the Model-A engine, isolated here so the
// rest of the engine stays pure and unit-tested. They are exercised by the
// test-mode verify pass, not unit tests.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getStripe } from "../stripe";
import type { OffSessionCharger } from "./charge";

/** Create a hosted Checkout that saves a card on file for a Model-A paid plan.
 *  Returns the redirect URL, or null if Stripe gives none. */
export async function createCardSetupCheckout(args: {
  ownerKey: string;
  email: string;
  planId: string;
  origin: string;
}): Promise<string | null> {
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: args.email,
    metadata: { ownerKey: args.ownerKey },
  });
  const meta = { ownerKey: args.ownerKey, planId: args.planId, modelA: "1" };
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customer.id,
    payment_method_types: ["card"],
    metadata: meta,
    setup_intent_data: { metadata: meta },
    success_url: `${args.origin}/profile?billing=cardsaved`,
    cancel_url: `${args.origin}/profile?billing=cancel`,
  });
  return session.url ?? null;
}

/** Production charger: an off-session PaymentIntent against the saved card. The
 *  PaymentIntent id is the idempotency key for the ledger draw-down. */
export const stripeOffSessionCharger: OffSessionCharger = async ({
  ownerKey,
  customerId,
  paymentMethodId,
  amountCents,
}) => {
  try {
    const pi = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: { ownerKey, modelA: "1" },
    });
    if (pi.status === "succeeded") return { ok: true, chargeId: pi.id };
    return { ok: false, error: pi.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "charge failed" };
  }
};
