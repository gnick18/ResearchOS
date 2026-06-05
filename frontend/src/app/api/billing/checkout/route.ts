// Metered-storage billing, create a Stripe Checkout session.
//
// POST /api/billing/checkout
//
// Authenticated. Starts a hosted Stripe Checkout for one recurring storage
// block, tagged with the caller's owner key so the webhook can credit the right
// lab. Dark unless BILLING_ENABLED is on. Test mode in dev, live only in prod.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getStoragePriceId, getStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

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
      line_items: [{ price: getStoragePriceId(), quantity: 1 }],
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
