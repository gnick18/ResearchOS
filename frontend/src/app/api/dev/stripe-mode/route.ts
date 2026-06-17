// Stripe mode self-check (OPERATOR tool, READ-ONLY). Reports whether the
// configured Stripe key is LIVE or TEST without ever exposing the key, so the
// operator can confirm what is deployed without reading a Sensitive env var.
//
// GET /api/dev/stripe-mode   Authorization: Bearer <CRON_SECRET>
//
// CRON_SECRET-gated (404 if unset/mismatched), the same secret Vercel Cron uses,
// so it is callable in prod by whoever holds it and is never an open endpoint.
// It returns only the key PREFIX-derived mode and a Stripe livemode ping, never
// the secret itself.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { getStripe } from "@/lib/billing/stripe";
import { isAiBillingEnabled, isBillingEnabled } from "@/lib/billing/config";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("not found", { status: 404 });
  }

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const stripeKeyMode = key.startsWith("sk_live_")
    ? "live"
    : key.startsWith("sk_test_")
      ? "test"
      : key
        ? "unknown-prefix"
        : "unset";

  // Authoritative confirmation: ask Stripe what mode the key actually operates in
  // (livemode true/false) and that it is a valid, working key. Read-only.
  let apiLivemode: boolean | null = null;
  let apiOk = false;
  let apiError: string | null = null;
  try {
    const balance = await getStripe().balance.retrieve();
    apiLivemode = balance.livemode;
    apiOk = true;
  } catch (e) {
    apiError = e instanceof Error ? e.message.slice(0, 120) : "stripe call failed";
  }

  return Response.json({
    ok: true,
    stripeKeyMode, // "live" | "test" | "unset" | "unknown-prefix" (from the prefix, key never exposed)
    apiOk, // did a real Stripe call succeed with this key
    apiLivemode, // Stripe's own livemode flag (the authoritative mode)
    apiError,
    webhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
    billingEnabled: isBillingEnabled(),
    aiBillingEnabled: isAiBillingEnabled(),
  });
}
