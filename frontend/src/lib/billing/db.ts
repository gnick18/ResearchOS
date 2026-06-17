// Flat-plan billing, persistence on Neon.
//
// Two tables.
//   billing_subscriptions: one row per owner (peppered email hash), the Stripe
//     ids, the owner's PLAN id (drives the storage + activity allowance), and the
//     status (active on a paid plan).
//   billing_events: an idempotency guard, every Stripe event id is recorded once
//     so a redelivered webhook never double-counts.
//
// The Neon driver is built lazily from DATABASE_URL. Schema creation is
// idempotent and called at the start of each billing route.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { FREE_ALLOWANCE_BYTES } from "./config";
import { getActiveGrant } from "./grants";
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
      cap_bytes bigint not null default ${sql.unsafe(String(FREE_ALLOWANCE_BYTES))},
      status text not null default 'inactive',
      updated_at timestamptz default now()
    )
  `;
  // Forward-migrate dev tables that predate the metered columns (the old block
  // model had a `blocks` column instead). IF NOT EXISTS makes this idempotent.
  await sql`ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS stripe_item_id text`;
  await sql`ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS cap_bytes bigint not null default ${sql.unsafe(String(FREE_ALLOWANCE_BYTES))}`;
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
 * The active subscriptions, owner key + plan id only. The Model-A accrual cron
 * enumerates these and resolves each to a Model-A plan (solo/lab) before rolling
 * up its usage. Free/inactive owners are excluded (they accrue nothing).
 */
export async function listActiveSubscriptions(): Promise<
  Array<{ ownerKey: string; planId: string }>
> {
  await ensureBillingSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT owner_key, plan_id FROM billing_subscriptions WHERE status = 'active'
  `) as Array<{ owner_key: string; plan_id: string }>;
  return rows.map((r) => ({ ownerKey: r.owner_key, planId: r.plan_id }));
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


/** The storage cap (bytes) a subscription's plan grants, free if unknown. */
function planStorageBytes(sub: SubscriptionRecord | null): number {
  const plan = getPlan(sub?.planId);
  return plan ? Math.max(FREE_ALLOWANCE_BYTES, plan.storageBytes) : FREE_ALLOWANCE_BYTES;
}

/**
 * Whether a subscription is actively sponsoring a lab, derived from its PLAN (a
 * paid LAB plan) rather than the legacy lab_billing flag, so the plan is the
 * single source of truth in the flat-plan model.
 */
/**
 * Pure predicate: whether a subscription is an ACTIVE, paid LAB-audience plan.
 * The single definition of "active lab tier", reused by isLabSponsor and the
 * cross-lane publish gate isLabPublishEntitled.
 */
export function isActiveLabPlan(sub: SubscriptionRecord | null): boolean {
  if (!sub || sub.status !== "active") return false;
  const plan = getPlan(sub.planId);
  return !!plan && plan.audience === "lab" && plan.priceCents > 0;
}

function isLabSponsor(sub: SubscriptionRecord | null): boolean {
  return isActiveLabPlan(sub);
}

/**
 * Cross-lane entitlement gate for the lab-domains / companion-sites lane (social
 * lane owns slug registry + rendering; this is the publish/edit gate it checks).
 * Self-contained (ensures schema) so the social lane can call it cold by lab
 * owner key. See docs/handoffs/2026-06-16-service-tier-model-build.md.
 *
 * Lab sites are a PAID lab-tier feature (Model A, Grant 2026-06-16): there are
 * NO free labs. Lab is a paid tier; the Free tier is the network audience
 * (receive-only, no produce features), so it must NOT be able to publish a lab
 * site. This gate is the SOLE lab-ness + entitlement check the create-site path
 * relies on, so it returns true ONLY for an active PAID lab-audience plan, which
 * correctly excludes individuals, free/network accounts, and lapsed labs. It is
 * NOT billing-flag-gated: the live verify pass uses a paid lab account (the dev
 * billing-sim seeds one) rather than relying on a beta free-for-all.
 */
export async function isLabPublishEntitled(labOwnerKey: string): Promise<boolean> {
  if (!labOwnerKey) return false;
  await ensureBillingSchema();
  return isActiveLabPlan(await getSubscription(labOwnerKey));
}

/**
 * Reclaim signal for the lab-domains / companion-sites lane. Returns
 * `{ lapsedAt }` when this lab is currently NOT on an active subscription (so the
 * social lane can GC its hosted R2 assets 30 days after `lapsedAt`), or `null`
 * when the lab is active or never subscribed (nothing to reclaim). `lapsedAt` is
 * the subscription row's last-updated time, which is when the Stripe webhook
 * flipped it off active. It only moves forward, so GC never fires early; if the
 * lab re-subscribes, this returns null again and the GC clock resets.
 */
export async function getLabLapse(
  labOwnerKey: string,
): Promise<{ lapsedAt: string } | null> {
  if (!labOwnerKey) return null;
  await ensureBillingSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT status, updated_at FROM billing_subscriptions WHERE owner_key = ${labOwnerKey}
  `) as Array<{ status: string; updated_at: string | null }>;
  if (!rows.length) return null; // never subscribed -> nothing hosted to reclaim
  if (rows[0].status === "active") return null; // active -> not lapsed
  const lapsedAt = rows[0].updated_at;
  return lapsedAt ? { lapsedAt } : null;
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
  let base = FREE_ALLOWANCE_BYTES;
  let usedLab = false;
  const sponsorKey = await getSponsoringLab(ownerKey).catch(() => null);
  if (sponsorKey) {
    const lab = await getSubscription(sponsorKey);
    if (isLabSponsor(lab)) {
      base = planStorageBytes(lab);
      usedLab = true;
    }
  }
  if (!usedLab) {
    const sub = await getSubscription(ownerKey);
    if (sub && sub.status === "active") {
      base = planStorageBytes(sub);
    }
  }
  // Add any operator-issued gift pool on this key (a grant on a PI lifts the
  // whole lab pool, since the pool resolves to the PI key). Fail-safe to no
  // bonus so a grants hiccup never shrinks or breaks the quota.
  const { bonusBytes } = await getActiveGrant(ownerKey).catch(() => ({
    bonusBytes: 0,
    bonusWrites: 0,
  }));
  return base + bonusBytes;
}

/**
 * The monthly write-operation allowance for an owner, resolved the same way as
 * the storage quota: an active lab member inherits the lab plan's allowance, an
 * active individual gets their own plan's, else the free plan's. This is the
 * throttle ceiling the activity enforcement (chunk C) checks the month against.
 */
export async function activityAllowanceForOwner(ownerKey: string): Promise<number> {
  const freeWrites = getPlan("free")?.activityWritesPerMonth ?? 0;
  let base = freeWrites;
  let usedLab = false;
  const sponsorKey = await getSponsoringLab(ownerKey).catch(() => null);
  if (sponsorKey) {
    const lab = await getSubscription(sponsorKey);
    if (isLabSponsor(lab)) {
      base = getPlan(lab?.planId)?.activityWritesPerMonth ?? freeWrites;
      usedLab = true;
    }
  }
  if (!usedLab) {
    const sub = await getSubscription(ownerKey);
    if (sub && sub.status === "active") {
      base = getPlan(sub.planId)?.activityWritesPerMonth ?? freeWrites;
    }
  }
  // Add any operator-issued gift pool on this key (activity side). Fail-safe.
  const { bonusWrites } = await getActiveGrant(ownerKey).catch(() => ({
    bonusBytes: 0,
    bonusWrites: 0,
  }));
  return base + bonusWrites;
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
 * Ends a member's own paid subscription when their lab takes over paying, so
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

