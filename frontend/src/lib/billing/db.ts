// Metered-storage billing, persistence on Neon.
//
// Three tables.
//   billing_subscriptions: one row per owner (peppered email hash), the Stripe
//     ids, the metered subscription item id (usage is reported against it), the
//     owner's storage CAP in bytes, and the status.
//   billing_usage_samples: a daily snapshot of each owner's used bytes, so the
//     monthly report can bill the AVERAGE GB-month (the basis Cloudflare uses).
//   billing_events: an idempotency guard, every Stripe event id is recorded once
//     so a redelivered webhook never double-counts.
//
// The Neon driver is built lazily from DATABASE_URL. Schema creation is
// idempotent and called at the start of each billing route.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { FREE_ALLOWANCE_BYTES } from "./config";

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
      stripe_item_id text,
      cap_bytes bigint not null default ${FREE_ALLOWANCE_BYTES},
      status text not null default 'inactive',
      updated_at timestamptz default now()
    )
  `;
  // Forward-migrate dev tables that predate the metered columns (the old block
  // model had a `blocks` column instead). IF NOT EXISTS makes this idempotent.
  await sql`ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS stripe_item_id text`;
  await sql`ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS cap_bytes bigint not null default ${FREE_ALLOWANCE_BYTES}`;
  await sql`
    CREATE TABLE IF NOT EXISTS billing_usage_samples (
      owner_key text not null,
      sampled_on date not null,
      used_bytes bigint not null,
      primary key (owner_key, sampled_on)
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
  stripeItemId: string | null;
  capBytes: number;
  status: string;
}

type SubRow = {
  owner_key: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_item_id: string | null;
  cap_bytes: string | number;
  status: string;
};

function rowToSub(r: SubRow): SubscriptionRecord {
  return {
    ownerKey: r.owner_key,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripeItemId: r.stripe_item_id,
    capBytes: Number(r.cap_bytes),
    status: r.status,
  };
}

export async function getSubscription(
  ownerKey: string,
): Promise<SubscriptionRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, stripe_item_id, cap_bytes, status
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
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, stripe_item_id, cap_bytes, status
    FROM billing_subscriptions WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `) as SubRow[];
  return rows.length ? rowToSub(rows[0]) : null;
}

/**
 * Inserts or updates an owner's Stripe + status state. Does NOT touch cap_bytes,
 * the cap is the user's own choice, set via setCapBytes, so a webhook sync never
 * overwrites it.
 */
export async function upsertSubscription(
  rec: Omit<SubscriptionRecord, "capBytes">,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO billing_subscriptions
      (owner_key, stripe_customer_id, stripe_subscription_id, stripe_item_id, status, updated_at)
    VALUES
      (${rec.ownerKey}, ${rec.stripeCustomerId}, ${rec.stripeSubscriptionId},
       ${rec.stripeItemId}, ${rec.status}, now())
    ON CONFLICT (owner_key) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      stripe_item_id = EXCLUDED.stripe_item_id,
      status = EXCLUDED.status,
      updated_at = now()
  `;
}

/**
 * Sets an owner's storage cap (bytes). Clamped to at least the free allowance so
 * the cap can never drop below what everyone gets for free. Creates the row if it
 * does not exist yet (a user can pick a cap as part of enabling paid storage).
 */
export async function setCapBytes(ownerKey: string, capBytes: number): Promise<void> {
  const sql = getSql();
  const clamped = Math.max(FREE_ALLOWANCE_BYTES, Math.floor(capBytes));
  await sql`
    INSERT INTO billing_subscriptions (owner_key, cap_bytes, updated_at)
    VALUES (${ownerKey}, ${clamped}, now())
    ON CONFLICT (owner_key) DO UPDATE SET cap_bytes = ${clamped}, updated_at = now()
  `;
}

/**
 * Total storage quota (bytes) for an owner. When the subscription is active the
 * quota is the owner's chosen cap; otherwise it is the free allowance. This is
 * the single number the collab / relay enforcement layer checks a write against.
 * Defined here so billing owns it and the enforcement just reads it.
 */
export async function quotaBytesForOwner(ownerKey: string): Promise<number> {
  const sub = await getSubscription(ownerKey);
  if (sub && sub.status === "active") {
    return Math.max(FREE_ALLOWANCE_BYTES, sub.capBytes);
  }
  return FREE_ALLOWANCE_BYTES;
}

// --- usage sampling (for the average-GB-month bill) ---

/** Records (or overwrites) today's used-bytes sample for an owner. */
export async function recordUsageSample(
  ownerKey: string,
  usedBytes: number,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO billing_usage_samples (owner_key, sampled_on, used_bytes)
    VALUES (${ownerKey}, current_date, ${Math.max(0, Math.floor(usedBytes))})
    ON CONFLICT (owner_key, sampled_on) DO UPDATE SET used_bytes = EXCLUDED.used_bytes
  `;
}

/**
 * Average used bytes for an owner over the samples on or after `sinceISODate`
 * (a YYYY-MM-DD string). Returns 0 when there are no samples. This is the basis
 * the monthly bill is computed from.
 */
export async function averageUsedBytes(
  ownerKey: string,
  sinceISODate: string,
): Promise<number> {
  const sql = getSql();
  const rows = (await sql`
    SELECT COALESCE(AVG(used_bytes), 0) AS avg_bytes
    FROM billing_usage_samples
    WHERE owner_key = ${ownerKey} AND sampled_on >= ${sinceISODate}
  `) as Array<{ avg_bytes: string | number }>;
  return Math.round(Number(rows[0]?.avg_bytes ?? 0));
}

/** Deletes usage samples older than `beforeISODate`, after a period is billed. */
export async function pruneUsageSamples(beforeISODate: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM billing_usage_samples WHERE sampled_on < ${beforeISODate}`;
}

/** Every owner with an active subscription, for the daily sampler / monthly bill. */
export async function listActiveOwners(): Promise<SubscriptionRecord[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, stripe_item_id, cap_bytes, status
    FROM billing_subscriptions WHERE status = 'active'
  `) as SubRow[];
  return rows.map(rowToSub);
}
