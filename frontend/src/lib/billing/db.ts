// Metered-storage billing, persistence on Neon.
//
// Two tables. billing_subscriptions holds one row per owner (keyed by the
// peppered email hash) with the Stripe ids, the active block count, and the
// subscription status. billing_events is an idempotency guard, every Stripe
// event id is recorded once so a redelivered webhook never double-counts a
// payment.
//
// The Neon driver is built lazily from DATABASE_URL. Schema creation is
// idempotent and called at the start of each billing route.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { paidStorageBytes } from "./config";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Billing cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

export async function ensureBillingSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      owner_key text primary key,
      stripe_customer_id text,
      stripe_subscription_id text,
      blocks int not null default 0,
      status text not null default 'inactive',
      updated_at timestamptz default now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS billing_events (
      id text primary key,
      received_at timestamptz default now()
    )
  `;
}

/**
 * Records a Stripe event id, returning true only the FIRST time it is seen.
 * A redelivered event returns false so the caller can skip it. This makes the
 * webhook idempotent without tracking per-handler state.
 */
export async function claimEvent(eventId: string): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO billing_events (id) VALUES (${eventId})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

export interface SubscriptionRecord {
  ownerKey: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  blocks: number;
  status: string;
}

type SubRow = {
  owner_key: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  blocks: number;
  status: string;
};

function rowToSub(r: SubRow): SubscriptionRecord {
  return {
    ownerKey: r.owner_key,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    blocks: Number(r.blocks),
    status: r.status,
  };
}

export async function getSubscription(
  ownerKey: string,
): Promise<SubscriptionRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, blocks, status
    FROM billing_subscriptions WHERE owner_key = ${ownerKey}
  `) as SubRow[];
  return rows.length ? rowToSub(rows[0]) : null;
}

/** Looks up the owner of a Stripe subscription, for events keyed only by sub id. */
export async function getSubscriptionByStripeId(
  stripeSubscriptionId: string,
): Promise<SubscriptionRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, blocks, status
    FROM billing_subscriptions WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `) as SubRow[];
  return rows.length ? rowToSub(rows[0]) : null;
}

/** Inserts or updates an owner's subscription state. */
export async function upsertSubscription(rec: SubscriptionRecord): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO billing_subscriptions
      (owner_key, stripe_customer_id, stripe_subscription_id, blocks, status, updated_at)
    VALUES
      (${rec.ownerKey}, ${rec.stripeCustomerId}, ${rec.stripeSubscriptionId},
       ${rec.blocks}, ${rec.status}, now())
    ON CONFLICT (owner_key) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      blocks = EXCLUDED.blocks,
      status = EXCLUDED.status,
      updated_at = now()
  `;
}

/**
 * The paid storage allowance (bytes) for an owner. Zero unless the subscription
 * is active. The free allowance is added on top by the storage-enforcement
 * layer (collab / relay), this is only the purchased part.
 */
export async function paidBytesForOwner(ownerKey: string): Promise<number> {
  const sub = await getSubscription(ownerKey);
  if (!sub || sub.status !== "active") return 0;
  return paidStorageBytes(sub.blocks);
}
