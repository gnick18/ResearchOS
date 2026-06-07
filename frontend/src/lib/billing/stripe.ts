// Flat-plan billing, the Stripe client and the env it needs.
//
// The client is built lazily from STRIPE_SECRET_KEY so importing this during
// build or tsc never requires a secret. Dev uses the test key (sk_test_); the
// live key (sk_live_) is only ever set in the production environment, after the
// flow is built and tested.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

/** Lazily constructs the Stripe client. Throws a clear error if the key is unset. */
export function getStripe(): Stripe {
  if (stripeSingleton) return stripeSingleton;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set. Billing cannot reach Stripe.");
  }
  stripeSingleton = new Stripe(key);
  return stripeSingleton;
}


/** The webhook signing secret used to verify Stripe event authenticity. */
export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  }
  return secret;
}
