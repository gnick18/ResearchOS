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
import {
  CAP_OPTIONS_GB,
  FREE_ALLOWANCE_BYTES,
  MIN_MONTHLY_CHARGE_CENTS,
  STORAGE_RATE_USD_PER_GB_MONTH,
  isBillingEnabled,
  maxMonthlyCostCents,
  monthlyChargeCents,
} from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema, getSubscription } from "@/lib/billing/db";
import { getOwnerUsage, getOwnerQuotaBytes } from "@/lib/collab/server/db";

export const runtime = "nodejs";

/** Best-effort current server usage for this owner; 0 if collab is not set up. */
async function ownerUsedBytes(ownerKey: string): Promise<number> {
  try {
    return await getOwnerUsage(ownerKey);
  } catch {
    return 0;
  }
}

const capOptions = CAP_OPTIONS_GB.map((gb) => ({
  gb,
  maxCostCents: maxMonthlyCostCents(gb),
}));

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
    const sub = await getSubscription(ownerKey);
    const active = sub?.status === "active";
    const capBytes = active
      ? Math.max(FREE_ALLOWANCE_BYTES, sub?.capBytes ?? FREE_ALLOWANCE_BYTES)
      : FREE_ALLOWANCE_BYTES;

    return json(200, {
      enabled: true,
      signedIn: true,
      active,
      usedBytes,
      freeBytes: FREE_ALLOWANCE_BYTES,
      capBytes,
      quotaBytes: capBytes,
      rateCents: Math.round(STORAGE_RATE_USD_PER_GB_MONTH * 100),
      minChargeCents: MIN_MONTHLY_CHARGE_CENTS,
      // Running estimate if this month's usage holds at the current level.
      estimatedChargeCents: monthlyChargeCents(usedBytes),
      capOptions,
    });
  } catch {
    return json(500, { error: "status failed" });
  }
}
