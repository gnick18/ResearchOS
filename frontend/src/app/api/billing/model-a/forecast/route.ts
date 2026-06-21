// Model A billing, the per-owner forecast + history the PI settings page reads.
//
// GET /api/billing/model-a/forecast
// Returns { forecast, history } for the signed-in owner, gated and structured
// exactly like /api/billing/model-a/status:
//   - 404 when BILLING_ENABLED is off (fail-closed, same pattern)
//   - 401 when no session
//   - 200 with the data when all checks pass
//
// forecast: the projected month-end charge broken down by component, plus the
//   monthly cap, computed live from current pooled usage via periodCharge.
// history: the 24 most recent ledger entries with a running balance, newest
//   first, so the PI can see every charge and credit without leaving Settings.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { resolveModelAPlanId } from "@/lib/billing/model-a/resolve";
import { getModelAPlan, periodCharge } from "@/lib/billing/model-a/pricing";
import { defaultUsageReader } from "@/lib/billing/model-a/accrual";
import { getMonthlyCap } from "@/lib/billing/model-a/ledger";
import { listLedgerEntries } from "@/lib/billing/model-a/ledger-db";

export const runtime = "nodejs";

/** The current billing period as a YYYY-MM string, used for the live usage
 *  reads that need a period label (pool writes are keyed by period). */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  const ownerKey = ownerKeyForEmail(email);
  try {
    const period = currentPeriod();

    // Resolve the owner's plan so we can run periodCharge with the right tier.
    const planId = await resolveModelAPlanId(ownerKey);
    const plan = getModelAPlan(planId);

    // Read usage + cap in parallel; they are independent reads.
    const [writes, storageBytes, hostedBytes, capCents, history] =
      await Promise.all([
        defaultUsageReader.poolWrites(ownerKey, period),
        defaultUsageReader.poolStorageBytes(ownerKey),
        defaultUsageReader.hostedBytes(ownerKey),
        getMonthlyCap(ownerKey),
        listLedgerEntries(ownerKey, 24),
      ]);

    const breakdown = periodCharge(plan, { writes, storageBytes, hostedBytes });

    return json(200, {
      forecast: {
        period,
        planId,
        breakdown: {
          baseCents: breakdown.baseCents,
          usageCents: breakdown.usageCents,
          storageCents: breakdown.storageCents,
          hostedCents: breakdown.hostedCents,
        },
        totalCents: breakdown.totalCents,
        capCents,
      },
      history: history.map((e) => ({
        period: e.period,
        kind: e.kind,
        cents: e.centsDelta,
        balanceCents: e.balanceCents,
        createdAt: e.createdAt,
      })),
    });
  } catch {
    return json(500, { error: "forecast failed" });
  }
}
