// Operator control for the cost circuit breaker (Grant 2026-06-07).
//
// GET  /api/admin/breaker   current breaker state + estimated monthly cost.
// POST /api/admin/breaker   { action: "setBudget", budgetCents } | { action: "trip" }
//                           | { action: "reset" }
//
// Operator-only, gated exactly like /api/admin/business (an unknown email gets a
// 404). Reset is the manual control the breaker design relies on. Active
// regardless of BILLING_ENABLED, this is a cost guard.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { isAdminEmail } from "@/lib/sharing/admin";
import { json } from "@/lib/sharing/directory/guard";
import {
  ensureBreakerSchema,
  estimateGlobalMonthlyCostCents,
  getBreakerState,
  resetBreaker,
  setBudgetCents,
  tripBreaker,
} from "@/lib/billing/breaker";

export const runtime = "nodejs";

async function gate(): Promise<Response | null> {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) return json(404, { error: "not found" });
  return null;
}

export async function GET(): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;
  try {
    await ensureBreakerSchema();
    const [state, cost] = await Promise.all([
      getBreakerState(),
      estimateGlobalMonthlyCostCents(),
    ]);
    return json(200, { state, cost });
  } catch {
    return json(500, { error: "breaker status failed" });
  }
}

export async function POST(request: Request): Promise<Response> {
  const blocked = await gate();
  if (blocked) return blocked;

  let body: { action?: unknown; budgetCents?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  try {
    await ensureBreakerSchema();
    switch (body.action) {
      case "setBudget": {
        const cents = Number(body.budgetCents);
        if (!Number.isFinite(cents) || cents < 0) {
          return json(400, { error: "invalid budget" });
        }
        await setBudgetCents(cents);
        break;
      }
      case "trip":
        await tripBreaker("manually tripped by operator");
        break;
      case "reset":
        await resetBreaker();
        break;
      default:
        return json(400, { error: "unknown action" });
    }
    return json(200, { ok: true, state: await getBreakerState() });
  } catch {
    return json(500, { error: "breaker action failed" });
  }
}
