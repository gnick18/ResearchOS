// Model A billing, save a card on file for a paid plan (engine step 4).
//
// POST /api/billing/model-a/card-setup   body { planId }
//
// Starts a hosted Stripe Checkout in "setup" mode (no charge) to save the buyer's
// card. The webhook stores the customer + payment method and activates the plan on
// completion. Usage then accrues monthly and the charge job runs the saved card
// when the balance crosses the threshold.
//
// Dark unless BILLING_ENABLED is on. The WI DOR sales-tax hard gate applies to a
// live key, same as the flat-plan checkout (a saved card precedes a real charge).
// Test mode (sk_test_) is unaffected.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema } from "@/lib/billing/db";
import { getModelAPlan } from "@/lib/billing/model-a/pricing";
import { createCardSetupCheckout } from "@/lib/billing/model-a/stripe-charger";

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
  const plan = getModelAPlan(typeof body.planId === "string" ? body.planId : "");
  // Only the paid produce tiers save a card. Free is the network tier, dept bills
  // on the org invoice track, not here.
  if (plan.id !== "solo" && plan.id !== "lab") {
    return json(400, { error: "unknown plan" });
  }

  const ownerKey = ownerKeyForEmail(email);

  try {
    await ensureBillingSchema();

    // Sales tax is handled by Stripe Tax (automatic_tax on the Checkout), so
    // there is no manual sales-tax gate here (Grant, settled). Stripe computes
    // and collects the right tax per jurisdiction at charge time.

    let origin: string;
    try {
      origin = process.env.BILLING_RETURN_ORIGIN ?? new URL(request.url).origin;
    } catch {
      origin = process.env.BILLING_RETURN_ORIGIN ?? "http://localhost:3000";
    }

    const url = await createCardSetupCheckout({
      ownerKey,
      email,
      planId: plan.id,
      origin,
    });
    if (!url) return json(500, { error: "no checkout url" });
    return json(200, { url, planId: plan.id });
  } catch {
    return json(500, { error: "card setup failed" });
  }
}
