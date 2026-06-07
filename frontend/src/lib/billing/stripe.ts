// Metered-storage billing, the Stripe client and the env it needs.
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

/** The metered storage price the checkout subscribes to (no quantity). */
export function getStoragePriceId(): string {
  const id = process.env.STRIPE_STORAGE_PRICE_ID;
  if (!id) {
    throw new Error("STRIPE_STORAGE_PRICE_ID is not set.");
  }
  return id;
}

/**
 * The Stripe Billing Meter event name the metered price is tied to. The monthly
 * report job sends usage as meter events with this name; Stripe aggregates them
 * over the billing period and the price turns them into the invoice line.
 */
export function getMeterEventName(): string {
  const name = process.env.STRIPE_METER_EVENT_NAME;
  if (!name) {
    throw new Error("STRIPE_METER_EVENT_NAME is not set.");
  }
  return name;
}

/**
 * Reports a customer's billable usage (in GB-month) to the storage meter. One
 * event per customer per month, the value is the month's billable gigabytes
 * (already free-tier-subtracted and minimum-waived by reportableGb). Stripe 22
 * removed the old usage records in favor of this Meter Events API.
 */
export async function reportStorageUsage(
  stripeCustomerId: string,
  billableGb: number,
): Promise<void> {
  await getStripe().billing.meterEvents.create({
    event_name: getMeterEventName(),
    payload: {
      stripe_customer_id: stripeCustomerId,
      value: String(billableGb),
    },
  });
}

/** The webhook signing secret used to verify Stripe event authenticity. */
export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  }
  return secret;
}
