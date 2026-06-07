// Metered-storage billing, the caller's storage status.
//
// GET /api/billing/status
//
// Returns the signed-in owner's usage, free tier, current cap, the metered rate,
// and the cap options (each with its max monthly cost), so the Settings UI can
// draw the usage panel and the "raise limit" picker. Shows usage even when
// BILLING_ENABLED is off (against the real enforced ceiling) so a signed-in
// sharing user always sees their footprint; the buy/raise controls gate on
// billing. Not signed in returns signedIn:false and the UI hides.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { FREE_ALLOWANCE_BYTES, isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema, getSubscription } from "@/lib/billing/db";
import { INDIVIDUAL_PLANS, planOrFree } from "@/lib/billing/plans";
import { ensureOpsSchema, opsSince } from "@/lib/billing/ops";
import { getOwnerUsage, getOwnerQuotaBytes } from "@/lib/collab/server/db";

/** Plan catalog shape the UI renders the picker + activity bar from. */
const planCatalog = INDIVIDUAL_PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  storageBytes: p.storageBytes,
  activityWritesPerMonth: p.activityWritesPerMonth,
  priceCents: p.priceCents,
}));

/** First day of the current month, YYYY-MM-DD, for the activity window. */
function monthStartISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

export const runtime = "nodejs";

/** Best-effort current server usage for this owner; 0 if collab is not set up. */
async function ownerUsedBytes(ownerKey: string): Promise<number> {
  try {
    return await getOwnerUsage(ownerKey);
  } catch {
    return 0;
  }
}

export async function GET(): Promise<Response> {
  const billingOn = isBillingEnabled();

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(200, { enabled: billingOn, signedIn: false });

  const ownerKey = ownerKeyForEmail(email);
  try {
    const usedBytes = await ownerUsedBytes(ownerKey);

    // Billing off (pre-launch default): show usage against the real enforced
    // ceiling (the fairness wall), no metered controls.
    if (!billingOn) {
      const quotaBytes = await getOwnerQuotaBytes(ownerKey).catch(
        () => FREE_ALLOWANCE_BYTES,
      );
      return json(200, {
        enabled: false,
        signedIn: true,
        active: false,
        freeBytes: quotaBytes,
        capBytes: quotaBytes,
        quotaBytes,
        usedBytes,
      });
    }

    await ensureBillingSchema();
    await ensureOpsSchema();
    const sub = await getSubscription(ownerKey);
    const active = sub?.status === "active";
    // Flat-plan model: storage cap + activity allowance come from the plan.
    const plan = planOrFree(active ? sub?.planId : "free", "individual");
    const capBytes = Math.max(FREE_ALLOWANCE_BYTES, plan.storageBytes);

    // This month's activity (write ops) against the plan allowance.
    const monthOps = await opsSince(ownerKey, monthStartISO()).catch(() => ({
      writes: 0,
      writtenBytes: 0,
    }));

    return json(200, {
      enabled: true,
      signedIn: true,
      active,
      usedBytes,
      freeBytes: FREE_ALLOWANCE_BYTES,
      capBytes,
      quotaBytes: capBytes,
      // Flat-plan fields.
      planId: plan.id,
      planName: plan.name,
      plans: planCatalog,
      activityWrites: monthOps.writes,
      activityAllowance: plan.activityWritesPerMonth,
    });
  } catch {
    return json(500, { error: "status failed" });
  }
}
