// Flat-plan billing, the unified PI roster (the one-roster-with-billing-chip view).
//
// POST /api/billing/lab/roster
//   body { members: { pubkey: string; username?: string }[] }
//   The caller (PI) sends their lab's DATA roster, which the client read from the
//   open LabRecordDO via getLabRemote (Ed25519 pubkeys + usernames, non-head).
//
// Returns the data-lab roster annotated with each member's billing status (the
// chip), plus billing-only sponsored collaborators (a seat with no folder access),
// plus the pool aggregate. This is the single read that powers the PI People
// surface: who is in my lab, and is each one a paid seat.
//
// The two memberships live on different planes (folder/data access in the DO vs
// the billing pool in Neon) and only meet at the directory binding. We resolve
// each posted pubkey to its email hash server-side, so the join stays authoritative
// and per-member usage is only ever returned for members actually sponsored by
// THIS caller's lab (a posted pubkey that is not in the caller's pool resolves to
// no usage, so nothing can be probed).
//
// Dark unless BILLING_ENABLED is on. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { FREE_ALLOWANCE_BYTES, isBillingEnabled } from "@/lib/billing/config";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { ensureBillingSchema } from "@/lib/billing/db";
import { ensureOpsSchema, opsSince } from "@/lib/billing/ops";
import {
  classifyLabRoster,
  ensureLabSchema,
  listLabMembers,
  type LabBillingStatus,
} from "@/lib/billing/lab";
import { getBindingByPubkey } from "@/lib/sharing/directory/db";
import { getOwnerUsage } from "@/lib/collab/server/db";

export const runtime = "nodejs";

/** First day of the current month, YYYY-MM-DD. */
function monthStartISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

async function usedBytes(ownerKey: string): Promise<number> {
  try {
    return await getOwnerUsage(ownerKey);
  } catch {
    return 0;
  }
}

async function monthWrites(ownerKey: string): Promise<number> {
  try {
    return (await opsSince(ownerKey, monthStartISO())).writes;
  } catch {
    return 0;
  }
}

interface RosterMemberOut {
  username: string | null;
  pubkey: string;
  memberKey: string | null;
  billingStatus: LabBillingStatus;
  usageVisible: boolean;
  /** PI sees per-member usage (they are the payer); null when not an active seat. */
  usedBytes: number | null;
  writes: number | null;
}

interface SponsoredOut {
  memberKey: string;
  label: string | null;
  status: "invited" | "active" | "declined";
  usageVisible: boolean;
  usedBytes: number | null;
  writes: number | null;
}

function parseMembers(
  raw: unknown,
): { pubkey: string; username: string | null }[] {
  if (!Array.isArray(raw)) return [];
  const out: { pubkey: string; username: string | null }[] = [];
  for (const m of raw) {
    const pubkey =
      m && typeof (m as { pubkey?: unknown }).pubkey === "string"
        ? (m as { pubkey: string }).pubkey.trim()
        : "";
    if (!pubkey) continue;
    const username = (m as { username?: unknown }).username;
    out.push({
      pubkey,
      username: typeof username === "string" ? username : null,
    });
  }
  return out;
}

export async function POST(request: Request): Promise<Response> {
  if (!isBillingEnabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const labOwnerKey = ownerKeyForEmail(email);

  let body: { members?: unknown };
  try {
    body = (await request.json()) as { members?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const posted = parseMembers(body.members);

  try {
    await ensureBillingSchema();
    await ensureLabSchema();
    await ensureOpsSchema();

    // Resolve each posted DO-roster pubkey to its billing key (email hash). An
    // unbound member (no directory identity yet) resolves to null and is shown as
    // no_identity rather than dropped, so the PI can see they are in the lab but
    // not yet billable.
    const dataMembers = await Promise.all(
      posted.map(async (m) => {
        let memberKey: string | null = null;
        try {
          const binding = await getBindingByPubkey(m.pubkey);
          memberKey = binding?.emailHash ?? null;
        } catch {
          memberKey = null;
        }
        return { pubkey: m.pubkey, username: m.username, memberKey };
      }),
    );

    const billingRows = await listLabMembers(labOwnerKey);
    const { members, sponsored } = classifyLabRoster(dataMembers, billingRows);

    // Enrich active seats with usage (the PI is the payer, so they see it). The
    // PI's own usage anchors the aggregate.
    const piUsed = await usedBytes(labOwnerKey);
    const piWrites = await monthWrites(labOwnerKey);
    let aggregateUsed = piUsed;
    let aggregateWrites = piWrites;

    const membersOut: RosterMemberOut[] = await Promise.all(
      members.map(async (m) => {
        const active = m.billingStatus === "active" && m.memberKey;
        const u = active ? await usedBytes(m.memberKey as string) : null;
        const w = active ? await monthWrites(m.memberKey as string) : null;
        if (active) {
          aggregateUsed += u ?? 0;
          aggregateWrites += w ?? 0;
        }
        return {
          username: m.username,
          pubkey: m.pubkey,
          memberKey: m.memberKey,
          billingStatus: m.billingStatus,
          usageVisible: m.usageVisible,
          usedBytes: u,
          writes: w,
        };
      }),
    );

    const sponsoredOut: SponsoredOut[] = await Promise.all(
      sponsored.map(async (s) => {
        const active = s.status === "active";
        const u = active ? await usedBytes(s.memberKey) : null;
        const w = active ? await monthWrites(s.memberKey) : null;
        if (active) {
          aggregateUsed += u ?? 0;
          aggregateWrites += w ?? 0;
        }
        return {
          memberKey: s.memberKey,
          label: s.label,
          status: s.status,
          usageVisible: s.usageVisible,
          usedBytes: u,
          writes: w,
        };
      }),
    );

    // The pooled seat count = PI + every active seat (data members + sponsored).
    const activeSeats =
      membersOut.filter((m) => m.billingStatus === "active").length +
      sponsoredOut.filter((s) => s.status === "active").length;

    return json(200, {
      enabled: true,
      members: membersOut,
      sponsored: sponsoredOut,
      sponsoredOwners: activeSeats + 1, // PI + active seats
      aggregateUsedBytes: aggregateUsed,
      aggregateWrites,
      freeBytes: FREE_ALLOWANCE_BYTES,
    });
  } catch {
    return json(500, { error: "roster failed" });
  }
}
