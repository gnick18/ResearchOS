// BeakerBot AI billing, the prepaid token top-up checkout (Phase 3).
//
// POST /api/billing/ai-topup   body { pack: "10" | "25" | "50" }
//
// Starts a one-time hosted Stripe Checkout for a token pack. Unlike the storage
// subscription (mode "subscription"), a token pack is a single purchase, so this
// uses mode "payment". The session carries the owner key and the chosen pack in
// metadata, the webhook reads them on completion and credits the ledger once
// (idempotent on the Stripe event id). Dark unless BILLING_ENABLED is on.
//
// Mirrors /api/billing/plan, the one-time-payment sibling of the subscription
// checkout, so the auth, owner-key, and return-origin handling match.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { aiPackPriceId, type AiPack } from "@/lib/billing/ai-config";
import { getStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";

const VALID_PACKS: readonly AiPack[] = ["10", "25", "50"];

function isAiPack(value: unknown): value is AiPack {
  return typeof value === "string" && (VALID_PACKS as readonly string[]).includes(value);
}

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  let body: { pack?: unknown };
  try {
    body = (await request.json()) as { pack?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  if (!isAiPack(body.pack)) return json(400, { error: "unknown pack" });
  const pack = body.pack;

  // The pack's one-time Stripe price must be configured (server-only env). When
  // it is not, answer clearly so the UI can say "not available yet" instead of
  // failing opaquely.
  const priceId = aiPackPriceId(pack);
  if (!priceId) return json(500, { error: "pack_unconfigured" });

  const ownerKey = ownerKeyForEmail(email);

  try {
    let origin: string;
    try {
      origin = process.env.BILLING_RETURN_ORIGIN ?? new URL(request.url).origin;
    } catch {
      origin = process.env.BILLING_RETURN_ORIGIN ?? "http://localhost:3000";
    }

    const checkout = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      // Stripe Tax computes sales tax per the buyer's location and our product
      // tax category (Software as a service). It collects ONLY where we are
      // registered and the product is taxable, so this is $0 in Wisconsin and
      // anywhere we are not registered. Tax calc needs the buyer's address, so
      // require it at checkout.
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      // Carry owner + pack so the webhook can credit the right tokens to the
      // right owner exactly once.
      metadata: { ownerKey, aiPack: pack },
      success_url: `${origin}/settings?section=ai&topup=success`,
      cancel_url: `${origin}/settings?section=ai&topup=cancel`,
    });
    if (!checkout.url) return json(500, { error: "no checkout url" });
    return json(200, { url: checkout.url, pack });
  } catch {
    return json(500, { error: "top-up failed" });
  }
}
