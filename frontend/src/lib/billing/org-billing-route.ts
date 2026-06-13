// Phase 3 org billing: the shared request handler behind /api/dept/billing and
// /api/institution/billing.
//
// Both tiers do the same thing (resolve the caller's entity, derive the monthly
// rate from the built plan, then create or update a send-invoice procurement
// subscription), differing only in the entity lookup, the rate function, and the
// plan-input shape. So the logic lives here once, parameterized by an OrgBilling
// spec, and each route is a thin wrapper that supplies its spec.
//
// Charging is doubly gated: the route is dark unless its tier flag is on, and a
// live Stripe key additionally requires the Wisconsin sales-tax determination to
// be resolved (mirrors /api/billing/plan). Test-mode is unaffected.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { json } from "@/lib/sharing/directory/guard";
import { auth } from "@/lib/sharing/auth";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { isBillingEnabled } from "@/lib/billing/config";
import { ensureBusinessSchema, getEntity } from "@/lib/business/db";
import {
  ensureOrgBillingSchema,
  getOrgBilling,
  type OrgBillingMethod,
  type OrgTier,
} from "@/lib/billing/org-billing";
import { setupOrgBilling } from "@/lib/billing/org-stripe";
import type { PayClass } from "@/lib/billing/processing-fee";

/** A resolved org entity the caller administers. */
export interface ResolvedOrgEntity {
  entityId: string;
  name: string;
}

export interface OrgBillingSpec {
  tier: OrgTier;
  /** Whether this tier's surface is enabled (its NEXT_PUBLIC flag). */
  enabled: boolean;
  /** Resolve the entity the caller is the admin of, or null. */
  resolveEntity: (adminOwnerKey: string) => Promise<ResolvedOrgEntity | null>;
  /** Validate + normalize the POST body into the plan inputs for this tier. */
  parsePlanInputs: (body: Record<string, unknown>) => Record<string, number> | null;
  /** Derive the monthly rate (cents) from the validated plan inputs. */
  deriveMonthlyCents: (inputs: Record<string, number>) => number;
}

async function liveTaxGateBlocks(): Promise<string | null> {
  const isLive = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ?? false;
  if (!isLive) return null;
  try {
    await ensureBusinessSchema();
    const entity = await getEntity();
    if (entity.salesTaxStatus === "pending") {
      return "Billing is blocked until the Wisconsin sales-tax determination is resolved.";
    }
    return null;
  } catch {
    return "sales-tax status unavailable";
  }
}

/** GET: the caller's current org billing status (plan inputs, rate, state). */
export async function handleOrgBillingGet(spec: OrgBillingSpec): Promise<Response> {
  if (!spec.enabled) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmailSafe(email);
  if (!adminOwnerKey) return json(503, { error: "billing identity unavailable" });

  try {
    await ensureOrgBillingSchema();
    const entity = await spec.resolveEntity(adminOwnerKey);
    if (!entity) return json(200, { enabled: true, entity: null });

    const row = await getOrgBilling(spec.tier, entity.entityId);
    return json(200, {
      enabled: true,
      billingEnabled: isBillingEnabled(),
      entity,
      status: row?.status ?? "inactive",
      method: row?.method ?? "invoice",
      payClass: row?.payClass ?? "bank",
      monthlyCents: row?.monthlyCents ?? 0,
      planInputs: row?.planInputs ?? {},
    });
  } catch {
    return json(500, { error: "could not load billing status" });
  }
}

/**
 * POST: save the built plan and create or update the procurement subscription.
 * Body carries the tier's plan inputs plus an optional poNumber. A plan that
 * derives to zero cancels back to no subscription. Takes the request so the body
 * is read once.
 */
export async function runOrgBillingPost(
  spec: OrgBillingSpec,
  request: Request,
): Promise<Response> {
  if (!spec.enabled) return json(404, { error: "not found" });
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmailSafe(email);
  if (!adminOwnerKey) return json(503, { error: "billing identity unavailable" });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const inputs = spec.parsePlanInputs(body);
  if (!inputs) return json(400, { error: "invalid plan inputs" });
  const poNumber =
    typeof body.poNumber === "string" && body.poNumber.trim()
      ? body.poNumber.trim()
      : null;
  // The collection the admin chose: an emailed invoice (net terms) or auto-charge
  // on file. Defaults to invoice, the procurement-canonical path.
  const method: OrgBillingMethod = body.method === "automatic" ? "automatic" : "invoice";
  // The pay class: card (list price) or bank debit (discounted). Defaults to bank,
  // since an invoice is normally paid by ACH and that earns the lower rate.
  const payClass: PayClass = body.payClass === "card" ? "card" : "bank";

  let returnOrigin: string;
  try {
    returnOrigin = process.env.BILLING_RETURN_ORIGIN ?? new URL(request.url).origin;
  } catch {
    returnOrigin = process.env.BILLING_RETURN_ORIGIN ?? "http://localhost:3000";
  }

  try {
    await ensureOrgBillingSchema();
    const entity = await spec.resolveEntity(adminOwnerKey);
    if (!entity) return json(404, { error: "no org entity for this account" });

    const blocked = await liveTaxGateBlocks();
    if (blocked) return json(409, { error: blocked });

    const monthlyCents = spec.deriveMonthlyCents(inputs);

    const result = await setupOrgBilling({
      tier: spec.tier,
      entityId: entity.entityId,
      info: { name: entity.name, email },
      planInputs: inputs,
      monthlyCents,
      method,
      payClass,
      poNumber,
      returnOrigin,
    });
    return json(200, { ok: true, monthlyCents, method, payClass, ...result });
  } catch {
    return json(500, { error: "billing setup failed" });
  }
}
