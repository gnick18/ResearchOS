// Model A billing, the per-owner status the UI reads (engine step, UI support).
//
// GET /api/billing/model-a/status
// Returns { planId, accruedCents, capCents, hasCard } for the signed-in owner, so
// the billing popup / settings can show the running accrued balance, the monthly
// cap, and whether a card is on file. Dark unless BILLING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import {
  resolveModelAPlanId,
  isProduceEntitled,
  getEffectiveModelAPlanId,
} from "@/lib/billing/model-a/resolve";
import { getActiveCompedTier } from "@/lib/billing/grants";
import { getSponsoringLab } from "@/lib/billing/lab";
import { getLabNameByPiKey } from "@/lib/sharing/directory/db";
import {
  getCloudBalance,
  getCloudPaymentMethod,
  getMonthlyCap,
  getLabTrialState,
} from "@/lib/billing/model-a/ledger";
import { labTrialPhase } from "@/lib/billing/model-a/lab-trial";

export const runtime = "nodejs";

/**
 * The lab that grants this member premium, for the settings "Premium, via X lab"
 * panel, or null. A member is premium only when (1) a lab sponsors them and (2)
 * that lab's PI resolves to a real paid or comped plan, so a member sponsored by
 * a lab whose PI is still free is NOT reported as premium (no false claim). The
 * lab name comes from the directory listing keyed by the PI owner key, and tier
 * is the plan the lab confers. Any error resolves to null so a lookup hiccup
 * never blocks the status read.
 */
async function resolveSponsoringLab(
  ownerKey: string,
): Promise<{ name: string; tier: "solo" | "lab" | "dept" } | null> {
  try {
    const sponsorKey = await getSponsoringLab(ownerKey);
    if (!sponsorKey || sponsorKey === ownerKey) return null;
    const sponsorPlan = await getEffectiveModelAPlanId(sponsorKey);
    if (sponsorPlan === "free") return null;
    const name = await getLabNameByPiKey(sponsorKey);
    return { name: name ?? "your lab", tier: sponsorPlan };
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  const ownerKey = ownerKeyForEmail(email);
  try {
    const [planId, accruedCents, capCents, card, produceEntitled, trial, sponsoringLab, compedTier] =
      await Promise.all([
        resolveModelAPlanId(ownerKey),
        getCloudBalance(ownerKey),
        getMonthlyCap(ownerKey),
        getCloudPaymentMethod(ownerKey),
        // Resolves a free member to their sponsoring PI, so a paid-lab member reads
        // as entitled to the produce features (send, co-edit, pairing) the PI covers.
        isProduceEntitled(ownerKey),
        getLabTrialState(ownerKey),
        // The lab that covers this member, so settings can say "covered by X lab"
        // instead of looking like the membership did nothing.
        resolveSponsoringLab(ownerKey),
        // Whether an operator gift comp is active (pure read, no rate change). Used
        // by the account hub to show the "Comped by ResearchOS" state pill instead
        // of "Active", since both resolve to the same planId.
        getActiveCompedTier(ownerKey).catch(() => null),
      ]);
    // Trial fields drive the settings countdown line and the day-90 pause prompt.
    // trialPhase is the single shared decision; trialEndsAt feeds the countdown.
    const trialPhase = labTrialPhase(trial);
    return json(200, {
      planId,
      accruedCents,
      capCents,
      hasCard: !!card,
      produceEntitled,
      trialEndsAt: trial.trialEndsAt,
      trialPhase,
      trialPaused: trialPhase === "ended_no_card",
      sponsoringLab,
      /** True when the effective plan is driven by an operator gift comp (not a real
       *  Stripe subscription). Lets the hub show "Comped by ResearchOS" instead of
       *  "Active" without re-fetching grants client-side. */
      isComped: compedTier !== null,
    });
  } catch {
    return json(500, { error: "status failed" });
  }
}
