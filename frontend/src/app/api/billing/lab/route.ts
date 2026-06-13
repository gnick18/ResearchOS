// Flat-plan billing, lab-level (consolidated) sponsorship.
//
// GET /api/billing/lab   the caller's lab plan, roster, aggregate usage +
//                        activity, and pending invites.
//
// A PI sponsors the whole lab by being on a paid LAB PLAN (picked via
// /api/billing/plan), which pools one storage allowance + activity allowance for
// a flat monthly price across all members. The PI is the payer, so the roster
// shows every member's storage and activity.
//
// Dark unless BILLING_ENABLED is on. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { FREE_ALLOWANCE_BYTES, isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema, getSubscription } from "@/lib/billing/db";
import { LAB_PLANS, freePlan, getPlan } from "@/lib/billing/plans";
import { ensureOpsSchema, opsSince } from "@/lib/billing/ops";
import {
  ensureLabSchema,
  getSponsoringLab,
  listInvitesForMember,
  listLabMembers,
} from "@/lib/billing/lab";
import { getOwnerUsage } from "@/lib/collab/server/db";

export const runtime = "nodejs";

/** The lab plan catalog shape the UI renders the picker from. */
const labPlanCatalog = LAB_PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  storageBytes: p.storageBytes,
  activityWritesPerMonth: p.activityWritesPerMonth,
  priceCents: p.priceCents,
}));

/** First day of the current month, YYYY-MM-DD. */
function monthStartISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

/** Best-effort current server usage for an owner key; 0 if collab is not set up. */
async function usedBytes(ownerKey: string): Promise<number> {
  try {
    return await getOwnerUsage(ownerKey);
  } catch {
    return 0;
  }
}

/** Best-effort this-month write count for an owner key. */
async function monthWrites(ownerKey: string): Promise<number> {
  try {
    return (await opsSince(ownerKey, monthStartISO())).writes;
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
    await ensureOpsSchema();

    const sub = await getSubscription(ownerKey);
    // Flat-plan model: the PI sponsors their lab by being on a paid LAB plan.
    // The lab plan sets the pooled storage cap + activity allowance + flat price.
    const subPlan = getPlan(sub?.planId);
    const labPlan =
      subPlan && subPlan.audience === "lab" && sub?.status === "active"
        ? subPlan
        : freePlan("lab");
    const labBillingOn = labPlan.priceCents > 0;

    // Roster (this caller acting as a PI).
    const members = await listLabMembers(ownerKey);
    const activeMembers = members.filter((m) => m.status === "active");
    const sponsoredOwners = activeMembers.length + 1; // PI + active members

    const piUsed = await usedBytes(ownerKey);
    const piWrites = await monthWrites(ownerKey);
    let aggregateUsed = piUsed;
    let aggregateWrites = piWrites;
    const roster = [] as Array<{
      memberKey: string;
      label: string | null;
      status: string;
      usageVisible: boolean;
      usedBytes: number | null;
      writes: number | null;
      // 'directory' = a real data-lab member (auto-enrolled from the DO roster);
      // 'invite' = a billing-only sponsored outside collaborator. The billing
      // popup uses this to show only outside collaborators, since data-lab members
      // now live in the unified People roster.
      source: "directory" | "invite";
    }>;
    for (const m of members) {
      const active = m.status === "active";
      const u = active ? await usedBytes(m.memberOwnerKey) : 0;
      const w = active ? await monthWrites(m.memberOwnerKey) : 0;
      if (active) {
        aggregateUsed += u;
        aggregateWrites += w;
      }
      roster.push({
        memberKey: m.memberOwnerKey,
        // PI-only label (the email the PI typed). Safe here, this is the PI's
        // own roster of their own lab.
        label: m.label,
        status: m.status,
        usageVisible: m.usageVisible,
        // The PI is the payer, so they always see each member's usage + activity
        // (Grant 2026-06-07).
        usedBytes: active ? u : null,
        writes: active ? w : null,
        source: m.source,
      });
    }

    // Invites where the caller is the invited member.
    const myInvites = await listInvitesForMember(ownerKey);
    const sponsoringLab = await getSponsoringLab(ownerKey);

    return json(200, {
      enabled: true,
      signedIn: true,
      // PI side, flat lab plan.
      canSponsor: true, // any PI can pick a lab plan (checkout handles payment)
      labBilling: labBillingOn,
      labPlanId: labPlan.id,
      labPlanName: labPlan.name,
      labPlans: labPlanCatalog,
      labCapBytes: labPlan.storageBytes,
      labActivityAllowance: labPlan.activityWritesPerMonth,
      estimatedChargeCents: labPlan.priceCents, // flat plan price
      sponsoredOwners,
      aggregateUsedBytes: aggregateUsed,
      aggregateWrites,
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
