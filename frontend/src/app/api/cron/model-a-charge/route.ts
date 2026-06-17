// Model A billing, off-session charge cron (engine step 4).
//
// GET /api/cron/model-a-charge
//
// Invoked by Vercel Cron (see frontend/vercel.json). It runs the saved card on
// file for every payer whose accrued balance crossed the threshold, drawing the
// balance down. Idempotent (recordCharge keys on the PaymentIntent id) and
// resilient (a decline leaves that balance accrued for the next run).
//
// Auth: CRON_SECRET bearer, fail closed with 404 if unset/mismatched. Flag: dark
// unless BILLING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isBillingEnabled } from "@/lib/billing/config";
import { runChargeRun } from "@/lib/billing/model-a/charge";
import { stripeOffSessionCharger } from "@/lib/billing/model-a/stripe-charger";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("not found", { status: 404 });
  }

  if (!isBillingEnabled()) {
    return Response.json({ ok: true, skipped: "billing disabled" });
  }

  try {
    const summary = await runChargeRun(stripeOffSessionCharger);
    return Response.json({ ok: true, ...summary });
  } catch {
    return Response.json({ ok: false, error: "charge run failed" }, { status: 500 });
  }
}
