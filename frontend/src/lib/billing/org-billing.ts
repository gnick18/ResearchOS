// Phase 3 org billing: persistence for the department + institution procurement
// subscriptions (Neon).
//
// Individuals and labs pay by Stripe hosted checkout (a card), one row per owner
// key in billing_subscriptions (db.ts). Departments and institutions pay
// procurement-style instead: a recurring subscription billed by SENT INVOICE with
// net terms (PO number, ACH or card), addressed to the ENTITY rather than a
// person. So the Stripe customer + subscription are keyed by the entity, not an
// owner key, and they live in their own table.
//
// One row per (tier, entity_id). The row also stores the built plan inputs so the
// monthly rate can be re-derived from the live plan each cycle (a plan change
// takes effect next cycle, no lock-in, per BILLING_FACTS.md), and the resolved
// monthly_cents the invoice was last set to.
//
// Status drives graceful degradation: a lapsed org invoice marks the entity
// past_due / canceled, which the cost circuit breaker can consult to pause cloud
// writes for the sponsored labs (local-first keeps working), never a hard lock.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sqlSingleton: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sqlSingleton) return sqlSingleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Org billing cannot reach Neon.");
  }
  sqlSingleton = neon(url);
  return sqlSingleton;
}

/** Which org tier a billing row belongs to. */
export type OrgTier = "department" | "institution";

/**
 * How the org pays. Procurement offices that require a purchase order get an
 * emailed invoice with net terms (pay by ACH or card on the hosted invoice);
 * smaller departments or a PI fronting the cost can auto-charge a card or bank
 * account on file each cycle. Both are real buyer types our pricing research
 * found, so the admin picks.
 */
export type OrgBillingMethod = "invoice" | "automatic";

/** A Stripe subscription billed by sent invoice moves through these states; we
 *  normalize Stripe's set onto active / past_due / canceled / inactive. */
export type OrgBillingStatus =
  | "inactive" // no subscription yet
  | "pending_checkout" // automatic method, awaiting the admin to add a card/bank
  | "active" // current
  | "past_due" // an invoice is open past its due date
  | "canceled"; // subscription ended

export interface OrgBillingRecord {
  tier: OrgTier;
  /** The generated dept_id / institution_id this row bills. */
  entityId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeItemId: string | null;
  /** The last-resolved monthly rate the subscription price was set to, in cents. */
  monthlyCents: number;
  /** The built plan inputs, re-derivable into monthlyCents. JSON-encoded as
   *  { labs, storageGb } (labs = active labs; institution labs is the total
   *  across all member departments, so the sustaining rate scales with size). */
  planInputs: Record<string, number>;
  /** How the org pays: an emailed invoice (net terms) or auto-charge on file. */
  method: OrgBillingMethod;
  status: OrgBillingStatus;
}

type OrgRow = {
  tier: string;
  entity_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_item_id: string | null;
  monthly_cents: string | number | null;
  plan_inputs: unknown;
  method: string | null;
  status: string;
};

function normalizeTier(raw: string): OrgTier {
  return raw === "institution" ? "institution" : "department";
}
function normalizeMethod(raw: string | null): OrgBillingMethod {
  return raw === "automatic" ? "automatic" : "invoice";
}
function normalizeStatus(raw: string): OrgBillingStatus {
  if (
    raw === "active" ||
    raw === "past_due" ||
    raw === "canceled" ||
    raw === "pending_checkout"
  )
    return raw;
  return "inactive";
}
function parseInputs(raw: unknown): Record<string, number> {
  if (raw && typeof raw === "object") return raw as Record<string, number>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? (v as Record<string, number>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function rowToRecord(r: OrgRow): OrgBillingRecord {
  return {
    tier: normalizeTier(r.tier),
    entityId: r.entity_id,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripeItemId: r.stripe_item_id,
    monthlyCents: Number(r.monthly_cents ?? 0),
    planInputs: parseInputs(r.plan_inputs),
    method: normalizeMethod(r.method),
    status: normalizeStatus(r.status),
  };
}

export async function ensureOrgBillingSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS org_billing (
      tier                   text not null,
      entity_id              text not null,
      stripe_customer_id     text,
      stripe_subscription_id text,
      stripe_item_id         text,
      monthly_cents          bigint not null default 0,
      plan_inputs            jsonb not null default '{}'::jsonb,
      method                 text not null default 'invoice',
      status                 text not null default 'inactive',
      created_at             timestamptz default now(),
      updated_at             timestamptz default now(),
      primary key (tier, entity_id)
    )
  `;
  // Forward-migrate a row that predates the payment-method choice.
  await sql`ALTER TABLE org_billing ADD COLUMN IF NOT EXISTS method text not null default 'invoice'`;
}

export async function getOrgBilling(
  tier: OrgTier,
  entityId: string,
): Promise<OrgBillingRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT tier, entity_id, stripe_customer_id, stripe_subscription_id,
           stripe_item_id, monthly_cents, plan_inputs, method, status
    FROM org_billing WHERE tier = ${tier} AND entity_id = ${entityId} LIMIT 1
  `) as OrgRow[];
  return rows.length ? rowToRecord(rows[0]) : null;
}

/** Looks up an org row by its Stripe subscription id, for webhook events that
 *  carry only the subscription. */
export async function getOrgBillingBySubId(
  stripeSubscriptionId: string,
): Promise<OrgBillingRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT tier, entity_id, stripe_customer_id, stripe_subscription_id,
           stripe_item_id, monthly_cents, plan_inputs, method, status
    FROM org_billing WHERE stripe_subscription_id = ${stripeSubscriptionId} LIMIT 1
  `) as OrgRow[];
  return rows.length ? rowToRecord(rows[0]) : null;
}

/** Persists the Stripe customer id for an entity, creating the row if needed. */
export async function setOrgCustomer(
  tier: OrgTier,
  entityId: string,
  stripeCustomerId: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO org_billing (tier, entity_id, stripe_customer_id, updated_at)
    VALUES (${tier}, ${entityId}, ${stripeCustomerId}, now())
    ON CONFLICT (tier, entity_id) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      updated_at = now()
  `;
}

/** Records the built plan inputs + the derived monthly rate for an entity. The
 *  Stripe subscription price is set from monthlyCents; storing the inputs lets a
 *  later cycle re-derive if the assumptions change. */
export async function setOrgPlan(
  tier: OrgTier,
  entityId: string,
  planInputs: Record<string, number>,
  monthlyCents: number,
  method: OrgBillingMethod,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO org_billing (tier, entity_id, plan_inputs, monthly_cents, method, updated_at)
    VALUES (${tier}, ${entityId}, ${JSON.stringify(planInputs)}, ${Math.max(0, Math.round(monthlyCents))}, ${method}, now())
    ON CONFLICT (tier, entity_id) DO UPDATE SET
      plan_inputs = ${JSON.stringify(planInputs)},
      monthly_cents = ${Math.max(0, Math.round(monthlyCents))},
      method = ${method},
      updated_at = now()
  `;
}

/** Records the Stripe subscription + item ids and the status after a
 *  subscription is created or a webhook syncs it. */
export async function setOrgSubscription(
  tier: OrgTier,
  entityId: string,
  stripeSubscriptionId: string | null,
  stripeItemId: string | null,
  status: OrgBillingStatus,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO org_billing
      (tier, entity_id, stripe_subscription_id, stripe_item_id, status, updated_at)
    VALUES
      (${tier}, ${entityId}, ${stripeSubscriptionId}, ${stripeItemId}, ${status}, now())
    ON CONFLICT (tier, entity_id) DO UPDATE SET
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      stripe_item_id = EXCLUDED.stripe_item_id,
      status = EXCLUDED.status,
      updated_at = now()
  `;
}

/** Sets just the status (webhook lifecycle), leaving ids + plan intact. */
export async function setOrgBillingStatus(
  tier: OrgTier,
  entityId: string,
  status: OrgBillingStatus,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE org_billing SET status = ${status}, updated_at = now()
    WHERE tier = ${tier} AND entity_id = ${entityId}
  `;
}
