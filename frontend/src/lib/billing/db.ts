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
import { getSponsoringLab } from "./lab";
import { getPlan } from "./plans";

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
  // lab_billing marks a PI who sponsors their whole lab on one invoice (chunk 3).
  // The monthly report bills such an owner on the lab aggregate, not their own
  // usage, against the pooled free tier.
  await sql`ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS lab_billing boolean not null default false`;
  // plan_id is the flat bundle plan an account is on (Grant 2026-06-07). It
  // drives the storage cap + activity allowance and replaces the per-GB metered
  // model. Defaults to the free plan, so an account is never on a paid plan
  // without choosing one. cap_bytes is kept for legacy/anchor reference only.
  await sql`ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS plan_id text not null default 'free'`;
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
  labBilling: boolean;
  /** The flat bundle plan the account is on (drives storage + activity). */
  planId: string;
}

type SubRow = {
  owner_key: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_item_id: string | null;
  cap_bytes: string | number;
  status: string;
  lab_billing: boolean | null;
  plan_id: string | null;
};

function rowToSub(r: SubRow): SubscriptionRecord {
  return {
    ownerKey: r.owner_key,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripeItemId: r.stripe_item_id,
    capBytes: Number(r.cap_bytes),
    status: r.status,
    labBilling: r.lab_billing === true,
    planId: r.plan_id ?? "free",
  };
}

export async function getSubscription(
  ownerKey: string,
): Promise<SubscriptionRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, stripe_item_id, cap_bytes, status, lab_billing, plan_id
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
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, stripe_item_id, cap_bytes, status, lab_billing, plan_id
    FROM billing_subscriptions WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `) as SubRow[];
  return rows.length ? rowToSub(rows[0]) : null;
}

/**
 * Inserts or updates an owner's Stripe + status state. Does NOT touch cap_bytes
 * or lab_billing, both are the user's own choices (setCapBytes / setLabBilling),
 * so a webhook sync never overwrites them.
 */
export async function upsertSubscription(
  rec: Omit<SubscriptionRecord, "capBytes" | "labBilling" | "planId">,
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

/** The storage cap (bytes) a subscription's plan grants, free if unknown. */
function planStorageBytes(sub: SubscriptionRecord | null): number {
  const plan = getPlan(sub?.planId);
  return plan ? Math.max(FREE_ALLOWANCE_BYTES, plan.storageBytes) : FREE_ALLOWANCE_BYTES;
}

/**
 * Total storage quota (bytes) for an owner. This is the single number the collab
 * / relay enforcement layer checks a write against. Defined here so billing owns
 * it and the enforcement just reads it.
 *
 * Flat-plan model (Grant 2026-06-07): the quota is the owner's PLAN storage cap
 * (a flat included allowance), not a metered cap. Payer resolution (chunk 3): a
 * member actively sponsored by a lab inherits the LAB plan's cap, so the lab-wide
 * wall doubles as each member's ceiling. Otherwise it is the owner's own active
 * plan, else the free plan.
 */
export async function quotaBytesForOwner(ownerKey: string): Promise<number> {
  const sponsorKey = await getSponsoringLab(ownerKey).catch(() => null);
  if (sponsorKey) {
    const lab = await getSubscription(sponsorKey);
    if (lab && lab.status === "active" && lab.labBilling) {
      return planStorageBytes(lab);
    }
  }
  const sub = await getSubscription(ownerKey);
  if (sub && sub.status === "active") {
    return planStorageBytes(sub);
  }
  return FREE_ALLOWANCE_BYTES;
}

/**
 * The monthly write-operation allowance for an owner, resolved the same way as
 * the storage quota: an active lab member inherits the lab plan's allowance, an
 * active individual gets their own plan's, else the free plan's. This is the
 * throttle ceiling the activity enforcement (chunk C) checks the month against.
 */
export async function activityAllowanceForOwner(ownerKey: string): Promise<number> {
  const freeWrites = getPlan("free")?.activityWritesPerMonth ?? 0;
  const sponsorKey = await getSponsoringLab(ownerKey).catch(() => null);
  if (sponsorKey) {
    const lab = await getSubscription(sponsorKey);
    if (lab && lab.status === "active" && lab.labBilling) {
      return getPlan(lab.planId)?.activityWritesPerMonth ?? freeWrites;
    }
  }
  const sub = await getSubscription(ownerKey);
  if (sub && sub.status === "active") {
    return getPlan(sub.planId)?.activityWritesPerMonth ?? freeWrites;
  }
  return freeWrites;
}

/**
 * Sets an owner's plan and marks the subscription active for a paid plan (free
 * reverts to inactive). The Stripe subscription itself is created at checkout;
 * this records which plan the account is on so the quota + activity allowance
 * resolve from it. Creates the row if needed.
 */
export async function setPlan(ownerKey: string, planId: string): Promise<void> {
  const sql = getSql();
  const plan = getPlan(planId);
  const id = plan ? plan.id : "free";
  const status = plan && plan.priceCents > 0 ? "active" : "inactive";
  await sql`
    INSERT INTO billing_subscriptions (owner_key, plan_id, status, updated_at)
    VALUES (${ownerKey}, ${id}, ${status}, now())
    ON CONFLICT (owner_key) DO UPDATE SET
      plan_id = ${id}, status = ${status}, updated_at = now()
  `;
}

/**
 * Turns lab billing on or off for a PI (the lab owner). When turning it on, the
 * caller has already ensured an active subscription exists to bill against.
 */
export async function setLabBilling(
  ownerKey: string,
  on: boolean,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO billing_subscriptions (owner_key, lab_billing, updated_at)
    VALUES (${ownerKey}, ${on}, now())
    ON CONFLICT (owner_key) DO UPDATE SET lab_billing = ${on}, updated_at = now()
  `;
}

/**
 * Ends a member's own metered subscription when their lab takes over paying, so
 * no one is double-billed. We mark the row inactive and drop the cap back to the
 * free tier; the member's effective ceiling then comes from the lab via
 * quotaBytesForOwner. Their Stripe ids are kept for receipts/history.
 */
export async function endIndividualSubscription(ownerKey: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE billing_subscriptions
    SET status = 'inactive', cap_bytes = ${FREE_ALLOWANCE_BYTES},
        plan_id = 'free', updated_at = now()
    WHERE owner_key = ${ownerKey}
  `;
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

/**
 * Average of the lab's DAILY AGGREGATE used bytes over the window. For each day
 * we sum the sampled usage across the given owner keys, then average those daily
 * totals, so the result is the aggregate average GB-month the PI's invoice bills
 * on. Returns 0 when there are no samples or no keys.
 */
export async function aggregateAverageUsedBytes(
  ownerKeys: string[],
  sinceISODate: string,
): Promise<number> {
  if (ownerKeys.length === 0) return 0;
  const sql = getSql();
  const rows = (await sql`
    SELECT COALESCE(AVG(daily_total), 0) AS avg_bytes FROM (
      SELECT sampled_on, SUM(used_bytes) AS daily_total
      FROM billing_usage_samples
      WHERE owner_key = ANY(${ownerKeys}) AND sampled_on >= ${sinceISODate}
      GROUP BY sampled_on
    ) AS daily
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
    SELECT owner_key, stripe_customer_id, stripe_subscription_id, stripe_item_id, cap_bytes, status, lab_billing, plan_id
    FROM billing_subscriptions WHERE status = 'active'
  `) as SubRow[];
  return rows.map(rowToSub);
}
