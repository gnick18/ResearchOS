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
import { resolveModelAPlanId, isProduceEntitled } from "@/lib/billing/model-a/resolve";
import {
  getCloudBalance,
  getCloudPaymentMethod,
  getMonthlyCap,
  getLabTrialState,
} from "@/lib/billing/model-a/ledger";
import { labTrialPhase } from "@/lib/billing/model-a/lab-trial";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  const ownerKey = ownerKeyForEmail(email);
  try {
    const [planId, accruedCents, capCents, card, produceEntitled, trial] = await Promise.all([
      resolveModelAPlanId(ownerKey),
      getCloudBalance(ownerKey),
      getMonthlyCap(ownerKey),
      getCloudPaymentMethod(ownerKey),
      // Resolves a free member to their sponsoring PI, so a paid-lab member reads
      // as entitled to the produce features (send, co-edit, pairing) the PI covers.
      isProduceEntitled(ownerKey),
      getLabTrialState(ownerKey),
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
    });
  } catch {
    return json(500, { error: "status failed" });
  }
}
