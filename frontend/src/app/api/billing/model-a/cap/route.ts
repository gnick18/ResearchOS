// Model A billing, set the monthly spend cap (engine step, UI support).
//
// POST /api/billing/model-a/cap   body { capCents: number | null }
// Sets (or clears with null) the signed-in owner's settable monthly $ cap. When a
// period's projected charge exceeds it, cloud sync pauses (the local app never
// stops) until next period or the cap is raised. Dark unless BILLING_ENABLED is on.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { setMonthlyCap } from "@/lib/billing/model-a/ledger";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  let body: { capCents?: unknown };
  try {
    body = (await request.json()) as { capCents?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }

  // null clears the cap; a number must be a non-negative integer of cents.
  let capCents: number | null;
  if (body.capCents === null) {
    capCents = null;
  } else if (
    typeof body.capCents === "number" &&
    Number.isInteger(body.capCents) &&
    body.capCents >= 0
  ) {
    capCents = body.capCents;
  } else {
    return json(400, { error: "capCents must be a non-negative integer or null" });
  }

  const ownerKey = ownerKeyForEmail(email);
  try {
    await setMonthlyCap(ownerKey, capCents);
    return json(200, { ok: true, capCents });
  } catch {
    return json(500, { error: "cap update failed" });
  }
}
