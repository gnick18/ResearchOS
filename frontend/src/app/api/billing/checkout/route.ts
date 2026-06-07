// Metered-storage billing, create a Stripe Checkout session.
//
// POST /api/billing/checkout
//
// Authenticated. Starts a hosted Stripe Checkout for the metered storage
// subscription (a metered price, nothing charged today), tagged with the caller's
// owner key so the webhook can attribute usage. The user picks their storage cap
// separately via /api/billing/cap. Dark unless BILLING_ENABLED is on. Test mode
// in dev, live only in prod.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getStoragePriceId, getStripe } from "@/lib/billing/stripe";
import { ensureBusinessSchema, getEntity } from "@/lib/business/db";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  // HARD GATE (sharing infra handoff 2026-06-05): never charge a REAL customer
  // until the WI DOR sales-tax determination lands. Test-mode checkout (sk_test_)
  // is unaffected so the flow can be built and tested; a LIVE key with the
  // determination still "pending" is refused.
  const isLive = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ?? false;
  if (isLive) {
    try {
      await ensureBusinessSchema();
      const entity = await getEntity();
      if (entity.salesTaxStatus === "pending") {
        return json(409, {
          error:
            "Billing is blocked until the Wisconsin sales-tax determination is resolved. Set the status in the business tracker once the WI DOR replies.",
        });
      }
    } catch {
      // Fail closed: if we cannot confirm the determination, do not charge.
      return json(409, { error: "sales-tax status unavailable" });
    }
  }

  const ownerKey = ownerKeyForEmail(email);

  let origin: string;
  try {
    origin = process.env.BILLING_RETURN_ORIGIN ?? new URL(request.url).origin;
  } catch {
    origin = process.env.BILLING_RETURN_ORIGIN ?? "http://localhost:3000";
  }

  try {
    const checkout = await getStripe().checkout.sessions.create({
      mode: "subscription",
      // Metered price, no quantity. Nothing is charged at checkout; usage is
      // reported monthly and Stripe invoices the aggregated average GB-month.
      line_items: [{ price: getStoragePriceId() }],
      customer_email: email,
      // Carry the owner key on BOTH the session and the subscription so every
      // downstream event can resolve the lab without storing a plaintext email.
      metadata: { ownerKey },
      subscription_data: { metadata: { ownerKey } },
      success_url: `${origin}/settings?billing=success`,
      cancel_url: `${origin}/settings?billing=cancel`,
    });
    if (!checkout.url) return json(500, { error: "no checkout url" });
    return json(200, { url: checkout.url });
  } catch {
    return json(500, { error: "checkout failed" });
  }
}
