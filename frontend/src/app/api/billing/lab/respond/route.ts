// Metered-storage billing, the member's response to a lab invite.
//
// POST /api/billing/lab/respond
//   body { labKey: string, action: "accept" | "decline",
//          usageVisible?: boolean }
//
// The member accepts or declines a PI's invite. Accepting starts the lab paying
// for them and ENDS any individual subscription they held, so no one is double
// billed; it also makes them sponsored by exactly one lab (accepting declines
// every other lab's invite). The optional usageVisible flag lets the member opt
// in to showing their individual usage to the PI (private by default).
//
// Dark unless BILLING_ENABLED is on. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { endIndividualSubscription, ensureBillingSchema } from "@/lib/billing/db";
import {
  acceptInvite,
  declineInvite,
  ensureLabSchema,
  setMemberUsageVisibility,
} from "@/lib/billing/lab";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  let body: { labKey?: unknown; action?: unknown; usageVisible?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const labKey = typeof body.labKey === "string" ? body.labKey : "";
  const action = body.action;
  if (!labKey) return json(400, { error: "labKey is required" });
  if (action !== "accept" && action !== "decline") {
    return json(400, { error: "action must be accept or decline" });
  }

  const memberKey = ownerKeyForEmail(email);
  try {
    await ensureBillingSchema();
    await ensureLabSchema();

    if (action === "decline") {
      await declineInvite(labKey, memberKey);
      return json(200, { ok: true, action });
    }

    const accepted = await acceptInvite(labKey, memberKey);
    if (!accepted) {
      return json(409, { error: "no pending invite from that lab" });
    }
    // The lab now pays for this member; end their own subscription so they are
    // not double-billed. Their cap reverts to free and the lab cap governs.
    await endIndividualSubscription(memberKey);

    if (typeof body.usageVisible === "boolean") {
      await setMemberUsageVisibility(labKey, memberKey, body.usageVisible);
    }
    return json(200, { ok: true, action });
  } catch {
    return json(500, { error: "respond failed" });
  }
}
