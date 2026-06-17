// Model A billing, monthly accrual cron (engine step 3).
//
// GET /api/cron/model-a-accrual
//
// Invoked by Vercel Cron once a month (see frontend/vercel.json). It rolls up the
// just-closed period's pooled usage for every active paid owner onto the cloud
// ledger (base fee + metered usage at the tier markup). The charge cron (step 4)
// later runs the card on file when a balance crosses the threshold. The run is
// idempotent per owner+period, so a retry or overlap is safe.
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}". Fail closed with
// a 404 if CRON_SECRET is unset or mismatched, so it is never an open trigger.
// Mirrors the lab-site-asset-gc cron.
//
// Flag: dark unless BILLING_ENABLED is on, so until billing goes live it no-ops
// after auth (no owner is on a paid Model-A plan during the beta anyway).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isBillingEnabled } from "@/lib/billing/config";
import { previousWritePeriod } from "@/lib/billing/period";
import { runAccrualForPeriod } from "@/lib/billing/model-a/cron";

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
    const period = previousWritePeriod();
    const summary = await runAccrualForPeriod(period);
    return Response.json({ ok: true, ...summary });
  } catch {
    return Response.json({ ok: false, error: "accrual failed" }, { status: 500 });
  }
}
