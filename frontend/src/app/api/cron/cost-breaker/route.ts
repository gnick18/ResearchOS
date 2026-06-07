// Cost-breaker cron (Grant 2026-06-07).
//
// GET /api/cron/cost-breaker
//
// Runs frequently (see frontend/vercel.json). Estimates the current total
// monthly provider cost (storage + activity) and trips the breaker if it has
// reached the configured budget. Tripping pauses cloud writes (collab + relay)
// so a viral spike on the free beta cannot run up an unbounded bill. Reset is
// manual on /admin, by decision, so spending never silently resumes.
//
// Auth: Vercel Cron sends "Authorization: Bearer ${CRON_SECRET}". Fails closed.
// Active regardless of BILLING_ENABLED, this is a cost guard, not billing.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  ensureBreakerSchema,
  estimateGlobalMonthlyCostCents,
  evaluateBudget,
} from "@/lib/billing/breaker";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("not found", { status: 404 });
  }

  try {
    await ensureBreakerSchema();
    const cost = await estimateGlobalMonthlyCostCents();
    // Budget guards VARIABLE cost (storage + activity), not the fixed base.
    const result = await evaluateBudget(cost.variableCents);
    return Response.json({
      ok: true,
      variableCents: cost.variableCents,
      totalCents: cost.totalCents,
      storageCents: cost.storageCents,
      activityCents: cost.activityCents,
      fixedBaseCents: cost.fixedBaseCents,
      budgetCents: result.budgetCents,
      tripped: result.tripped,
    });
  } catch {
    return Response.json({ ok: false, error: "evaluation failed" }, { status: 500 });
  }
}
