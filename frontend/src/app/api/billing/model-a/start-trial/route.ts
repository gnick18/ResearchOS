// Model A billing, start a lab's 90-day free trial (Grant 2026-06-19).
//
// POST /api/billing/model-a/start-trial
//
// A new lab head signs up with NO card. This activates them on the Model-A "lab"
// tier and stamps a 90-day trial (LAB_TRIAL_DAYS) on their cloud_balance row, so
// they are a real provisioned lab head with the produce features unlocked but are
// not charged for the trial regardless of usage. No Stripe call happens here, so
// the external-redirect that used to drop the local folder permission is gone.
//
// Idempotent: a reload or a double-submit re-activates the same plan and leaves an
// already-running trial's end date untouched (startLabTrial COALESCEs). Dark
// unless BILLING_ENABLED is on, so a deploy without billing configured provisions
// the lab without any billing state, exactly as the no-card path does today.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled, LAB_TRIAL_DAYS } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema, activateLabTrialSubscription } from "@/lib/billing/db";
import { startLabTrial } from "@/lib/billing/model-a/ledger";
import { trialEndsAtFrom } from "@/lib/billing/model-a/lab-trial";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  // Billing off: the lab is already provisioned by the lab-create path, so there
  // is simply no trial state to record. A clean 200 no-op keeps the client wiring
  // identical whether or not billing is live.
  if (!isBillingEnabled()) return json(200, { ok: true, billing: false });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  const ownerKey = ownerKeyForEmail(email);
  const trialEndsAt = trialEndsAtFrom(new Date(), LAB_TRIAL_DAYS);

  try {
    await ensureBillingSchema();
    // Record the lab tier and the trial window. Order matters only for the
    // resolver to read "lab + active" together with the trial stamp; both are
    // idempotent, so a retry is safe.
    await activateLabTrialSubscription(ownerKey);
    await startLabTrial(ownerKey, trialEndsAt);
    return json(200, { ok: true, billing: true, trialEndsAt });
  } catch {
    return json(500, { error: "start trial failed" });
  }
}
