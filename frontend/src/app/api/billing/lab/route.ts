// Metered-storage billing, lab-level (consolidated) sponsorship.
//
// GET  /api/billing/lab   the caller's lab role, roster, and pending invites.
// POST /api/billing/lab   body { on: boolean }   the PI turns lab billing on/off.
//
// Lab billing lets a PI pay for the whole lab on one metered invoice. Enabling it
// requires the PI to already have an active subscription (a card on file), since
// the lab aggregate bills against it. The roster shows the lab aggregate usage
// always, and each member's individual usage only where that member opted in.
//
// Dark unless BILLING_ENABLED is on. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import {
  FREE_ALLOWANCE_BYTES,
  isBillingEnabled,
  labFreePoolBytes,
  labMonthlyChargeCents,
} from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import {
  ensureBillingSchema,
  getSubscription,
  setLabBilling,
} from "@/lib/billing/db";
import {
  ensureLabSchema,
  getSponsoringLab,
  listInvitesForMember,
  listLabMembers,
} from "@/lib/billing/lab";
import { getOwnerUsage } from "@/lib/collab/server/db";

export const runtime = "nodejs";

/** Best-effort current server usage for an owner key; 0 if collab is not set up. */
async function usedBytes(ownerKey: string): Promise<number> {
  try {
    return await getOwnerUsage(ownerKey);
  } catch {
    return 0;
  }
}

export async function GET(): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  const ownerKey = ownerKeyForEmail(email);
  try {
    await ensureBillingSchema();
    await ensureLabSchema();

    const sub = await getSubscription(ownerKey);
    const labBillingOn = sub?.labBilling === true && sub?.status === "active";

    // Roster (this caller acting as a PI).
    const members = await listLabMembers(ownerKey);
    const activeMembers = members.filter((m) => m.status === "active");
    const sponsoredOwners = activeMembers.length + 1; // PI + active members
    const poolBytes = labFreePoolBytes(sponsoredOwners);

    const piUsed = await usedBytes(ownerKey);
    let aggregateUsed = piUsed;
    const roster = [] as Array<{
      memberKey: string;
      label: string | null;
      status: string;
      usageVisible: boolean;
      usedBytes: number | null;
    }>;
    for (const m of members) {
      const u = m.status === "active" ? await usedBytes(m.memberOwnerKey) : 0;
      if (m.status === "active") aggregateUsed += u;
      roster.push({
        memberKey: m.memberOwnerKey,
        // PI-only label (the email the PI typed). Safe here, this is the PI's
        // own roster of their own lab.
        label: m.label,
        status: m.status,
        usageVisible: m.usageVisible,
        // The PI is the payer, so they always see each member's usage (Grant
        // 2026-06-07, reverses the earlier per-member opt-in). usage_visible is
        // retained but no longer gates this.
        usedBytes: m.status === "active" ? u : null,
      });
    }

    // Invites where the caller is the invited member.
    const myInvites = await listInvitesForMember(ownerKey);
    const sponsoringLab = await getSponsoringLab(ownerKey);

    return json(200, {
      enabled: true,
      signedIn: true,
      // PI side.
      canSponsor: sub?.status === "active",
      labBilling: labBillingOn,
      sponsoredOwners,
      poolBytes,
      aggregateUsedBytes: aggregateUsed,
      estimatedChargeCents: labMonthlyChargeCents(aggregateUsed, sponsoredOwners),
      roster,
      // Member side.
      sponsoredByLab: sponsoringLab,
      pendingInvites: myInvites.map((i) => ({ labKey: i.labOwnerKey })),
      freeBytes: FREE_ALLOWANCE_BYTES,
    });
  } catch {
    return json(500, { error: "lab status failed" });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });

  let body: { on?: unknown };
  try {
    body = (await request.json()) as { on?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  if (typeof body.on !== "boolean") {
    return json(400, { error: "on must be a boolean" });
  }

  const ownerKey = ownerKeyForEmail(email);
  try {
    await ensureBillingSchema();
    await ensureLabSchema();

    if (body.on) {
      // Turning lab billing on needs an active subscription to bill against.
      const sub = await getSubscription(ownerKey);
      if (sub?.status !== "active") {
        return json(409, {
          error: "Add a payment method first to sponsor your lab.",
          needsCheckout: true,
        });
      }
    }

    await setLabBilling(ownerKey, body.on);
    return json(200, { ok: true, labBilling: body.on });
  } catch {
    return json(500, { error: "lab billing toggle failed" });
  }
}
