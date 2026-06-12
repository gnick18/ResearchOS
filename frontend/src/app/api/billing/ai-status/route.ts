// BeakerBot AI billing, the caller's token balance + recent tasks (Phase 4).
//
// GET /api/billing/ai-status
//
// The read side of the AI ledger, so the Settings "AI usage" section can show a
// real balance and the recent per-task costs instead of fixtures. Mirrors
// /api/billing/status (session via auth(), owner key via ownerKeyForEmail).
//
// Enforcement off (AI_BILLING_ENABLED unset, the current default): there is no
// live ledger to read, so we return a clearly-flagged inert response (enabled
// false, a zero balance, no tasks) rather than minting a gift or crashing. The
// gift is granted on FIRST METERED USE through the proxy, never from this read,
// so opening Settings can never mint anyone a balance.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { getOrGrantBalance, getRecentTasks } from "@/lib/billing/ai-ledger";

export const runtime = "nodejs";

/** Whether AI billing enforcement is on. Same fail-closed switch the proxy reads. */
function isAiBillingEnabled(): boolean {
  const v = process.env.AI_BILLING_ENABLED;
  return v === "1" || v === "true";
}

export async function GET(): Promise<Response> {
  const billingOn = isAiBillingEnabled();

  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return json(200, { enabled: billingOn, signedIn: false });
  }

  // Enforcement off, or no DB configured: inert, flagged, never crashes, and never
  // mints a balance. The UI shows the beta "AI is free" framing in this state.
  if (!billingOn || !process.env.DATABASE_URL) {
    return json(200, {
      enabled: false,
      signedIn: true,
      balance: 0,
      recentTasks: [],
    });
  }

  const ownerKey = ownerKeyForEmail(email);
  try {
    // getOrGrantBalance is the same call the proxy uses, so a user who has used
    // BeakerBot sees the gift reflected here too (it is minted on first metered
    // use, this read just surfaces whatever the ledger already holds).
    const balance = await getOrGrantBalance(ownerKey);
    const recentTasks = await getRecentTasks(ownerKey, 8);
    return json(200, {
      enabled: true,
      signedIn: true,
      balance,
      recentTasks,
    });
  } catch {
    return json(500, { error: "ai status failed" });
  }
}
