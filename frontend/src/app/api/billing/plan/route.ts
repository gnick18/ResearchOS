// Flat-plan billing, choose a plan (Grant 2026-06-07).
//
// POST /api/billing/plan   body { planId }
//
// The single control of the bundle model. Choosing the FREE plan downgrades
// immediately (no Stripe). Choosing a PAID plan starts a hosted Stripe Checkout
// for that plan's flat subscription price; the webhook records the plan active on
// completion. Replaces the metered /api/billing/cap control.
//
// Dark unless BILLING_ENABLED is on. The WI DOR sales-tax hard gate applies to
// live charges, same as the old checkout. Test mode (sk_test_) is unaffected.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getPlan, isPaidPlan, stripePriceId } from "@/lib/billing/plans";
import { ensureBillingSchema, setPlan } from "@/lib/billing/db";
import { getStripe } from "@/lib/billing/stripe";
import { ensureBusinessSchema, getEntity } from "@/lib/business/db";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  let body: { planId?: unknown };
  try {
    body = (await request.json()) as { planId?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const plan = getPlan(typeof body.planId === "string" ? body.planId : "");
  if (!plan) return json(400, { error: "unknown plan" });

  const ownerKey = ownerKeyForEmail(email);

  try {
    await ensureBillingSchema();

    // Free plan: downgrade immediately, nothing to charge.
    if (!isPaidPlan(plan)) {
      await setPlan(ownerKey, plan.id);
      return json(200, { ok: true, planId: plan.id });
    }

    // Paid plan needs its Stripe flat price configured.
    const priceId = stripePriceId(plan);
    if (!priceId) {
      return json(409, { error: "this plan is not available yet" });
    }

    // HARD GATE: never charge a real customer until the WI DOR sales-tax
    // determination lands. Test-mode (sk_test_) is unaffected.
    const isLive = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ?? false;
    if (isLive) {
      try {
        await ensureBusinessSchema();
        const entity = await getEntity();
        if (entity.salesTaxStatus === "pending") {
          return json(409, {
            error:
              "Billing is blocked until the Wisconsin sales-tax determination is resolved.",
          });
        }
      } catch {
        return json(409, { error: "sales-tax status unavailable" });
      }
    }

    let origin: string;
    try {
      origin = process.env.BILLING_RETURN_ORIGIN ?? new URL(request.url).origin;
    } catch {
      origin = process.env.BILLING_RETURN_ORIGIN ?? "http://localhost:3000";
    }

    const checkout = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      // Carry owner + plan so the webhook records the right plan on this owner.
      metadata: { ownerKey, planId: plan.id },
      subscription_data: { metadata: { ownerKey, planId: plan.id } },
      success_url: `${origin}/profile?billing=success`,
      cancel_url: `${origin}/profile?billing=cancel`,
    });
    if (!checkout.url) return json(500, { error: "no checkout url" });
    return json(200, { url: checkout.url, planId: plan.id });
  } catch {
    return json(500, { error: "plan change failed" });
  }
}
