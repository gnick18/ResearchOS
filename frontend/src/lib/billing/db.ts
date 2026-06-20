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
import { getActiveCompedTier } from "./grants";
import { getModelAPlan } from "./model-a/pricing";
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


/**
 * Pure predicate: whether a subscription is an ACTIVE, paid LAB-audience plan.
 * The single definition of "active lab tier", used by the cross-lane publish
 * gate isLabPublishEntitled.
 */
export function isActiveLabPlan(sub: SubscriptionRecord | null): boolean {
  if (!sub || sub.status !== "active") return false;
  const plan = getPlan(sub.planId);
  return !!plan && plan.audience === "lab" && plan.priceCents > 0;
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
 * relies on. It returns true when:
 *   - the real subscription is an active paid lab-audience plan (existing path),
 *   OR
 *   - the operator has issued an active comped tier of "lab" or "dept" on this
 *     key (new: gift-card premium entitlement, Grant 2026-06-19). A "solo" comp
 *     is an individual tier and does NOT grant lab-publish access.
 *
 * A comp never creates a Stripe subscription and never downgrades a real paid
 * plan. AI tokens are not comped here (decision 1, Grant 2026-06-19).
 */
export async function isLabPublishEntitled(labOwnerKey: string): Promise<boolean> {
  if (!labOwnerKey) return false;
  await ensureBillingSchema();
  if (isActiveLabPlan(await getSubscription(labOwnerKey))) return true;
  // OR-in a lab/dept comped tier. A "solo" comp is individual-only and must
  // not unlock lab publishing. Fail-safe to false so a grants hiccup never
  // opens the gate.
  const compedTier = await getActiveCompedTier(labOwnerKey).catch(() => null);
  return compedTier === "lab" || compedTier === "dept";
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
 * Activate a lab on the Model-A "lab" tier directly (Grant 2026-06-19, no-card
 * free trial). The flat-plan setPlan() cannot do this: "lab" is a Model-A plan id,
 * not a flat-plan catalog id, so getPlan("lab") is null and setPlan would store
 * free/inactive. The Model-A resolver (modelAPlanForSubscription) expects
 * plan_id = "lab" + status = "active", so we write exactly that. No Stripe object
 * is created (Model-A labs bill off a saved card + off-session PaymentIntents, not
 * a Stripe subscription), so this records the plan without a card. The 90-day
 * trial timestamp lives separately on cloud_balance via startLabTrial. Idempotent
 * on the owner key; never overwrites a row that is already on a real paid plan.
 */
export async function activateLabTrialSubscription(ownerKey: string): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO billing_subscriptions (owner_key, plan_id, status, updated_at)
    VALUES (${ownerKey}, 'lab', 'active', now())
    ON CONFLICT (owner_key) DO UPDATE SET
      plan_id = 'lab', status = 'active', updated_at = now()
      WHERE billing_subscriptions.plan_id IS NULL
         OR billing_subscriptions.plan_id = 'free'
         OR billing_subscriptions.status <> 'active'
  `;
}

/**
 * Activates a Model-A plan for an owner, writing the Model-A plan id (solo / lab /
 * dept) DIRECTLY with an active status. The Model-A card-setup webhook calls this
 * once the saved-card Checkout completes.
 *
 * This is distinct from setPlan, which resolves a FLAT catalog id (plus / pro /
 * lab_plus...). The Model-A ids are not in that catalog, so routing them through
 * setPlan resolves getPlan() to null and writes plan_id="free" status="inactive",
 * which makes modelAPlanForSubscription read a genuine paid lab as free (it would
 * under-charge and mis-gate the lab). Writing the Model-A id directly is what the
 * resolver expects (planId="lab" status="active" -> "lab"). An unknown id or the
 * free tier writes free / inactive, so a bad value never grants paid room. Creates
 * the row if needed.
 */
export async function setModelAPlan(
  ownerKey: string,
  modelAPlanId: string,
): Promise<void> {
  const sql = getSql();
  const plan = getModelAPlan(modelAPlanId);
  // solo / lab / dept are the paid produce tiers; free is the network audience.
  const paid = plan.id !== "free";
  const id = paid ? plan.id : "free";
  const status = paid ? "active" : "inactive";
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

