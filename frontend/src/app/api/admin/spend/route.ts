// Operator monthly money-flow: estimated cost OUT (by category/vendor) and
// recorded revenue IN (by source), for the spend visual on /admin and
// /admin/business. Operator-only, gated like the other admin routes.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { isAdminEmail } from "@/lib/sharing/admin";
import { json } from "@/lib/sharing/directory/guard";
import {
  VERCEL_BASE_CENTS,
  WORKERS_BASE_CENTS,
  estimateGlobalMonthlyCostCents,
} from "@/lib/billing/breaker";
import { ensureBusinessSchema, listLedger } from "@/lib/business/db";

export const runtime = "nodejs";

/** Palette for revenue sources, indexed deterministically by appearance order. */
const REVENUE_COLORS = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6"];

/** YYYY-MM prefix of the current month, for filtering ledger dates. */
function monthPrefix(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return json(404, { error: "not found" });
  }

  try {
    const cost = await estimateGlobalMonthlyCostCents();

    // Money OUT, estimated provider cost by category (vendor-tagged).
    const outCategories = [
      { label: "Hosting", vendor: "Vercel", cents: VERCEL_BASE_CENTS, fixed: true, color: "#6366f1" },
      { label: "Compute base", vendor: "Cloudflare Workers", cents: WORKERS_BASE_CENTS, fixed: true, color: "#f59e0b" },
      { label: "Doc storage", vendor: "Durable Objects", cents: cost.doCents, fixed: false, color: "#0ea5e9" },
      { label: "File storage", vendor: "Cloudflare R2", cents: cost.r2Cents, fixed: false, color: "#10b981" },
      { label: "Activity", vendor: "Cloudflare", cents: cost.activityCents, fixed: false, color: "#8b5cf6" },
    ];

    // Money IN, recorded revenue THIS MONTH grouped by category (empty until we
    // have revenue). Pulled from the business ledger, direction 'in'.
    let inCategories: { label: string; cents: number; color: string }[] = [];
    let inTotalCents = 0;
    try {
      await ensureBusinessSchema();
      const ledger = await listLedger();
      const prefix = monthPrefix();
      const byCategory = new Map<string, number>();
      for (const e of ledger) {
        if (e.direction !== "in") continue;
        if (!e.date.startsWith(prefix)) continue;
        const key = e.category || "Other";
        byCategory.set(key, (byCategory.get(key) ?? 0) + e.amountCents);
        inTotalCents += e.amountCents;
      }
      inCategories = [...byCategory.entries()].map(([label, cents], i) => ({
        label,
        cents,
        color: REVENUE_COLORS[i % REVENUE_COLORS.length],
      }));
    } catch {
      // ledger unavailable, leave revenue empty
    }

    return json(200, {
      out: { categories: outCategories, totalCents: cost.totalCents },
      in: { categories: inCategories, totalCents: inTotalCents },
    });
  } catch {
    return json(500, { error: "spend lookup failed" });
  }
}
