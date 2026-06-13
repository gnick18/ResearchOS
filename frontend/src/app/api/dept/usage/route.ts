// Department tier Phase 2: the dept admin's usage breakdown + over-time history.
//
// GET /api/dept/usage
//   Resolves the caller's department, then aggregates usage DOWN the tree:
//   dept -> each active lab head -> that lab's accounts (head + active members).
//   Returns per-account, per-lab, and dept totals (storage + this-month activity),
//   plus the monthly history. Opportunistically upserts this month's snapshot so
//   the over-time trend accumulates without a cron.
//
// Visibility (locked with Grant): the dept admin is the payer, so they see account
// labels + usage figures by lab and account, never research-data contents.
//
// Dark unless DEPT_TIER_ENABLED. Sign-in required. Read-only (aside from the
// idempotent monthly snapshot).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import {
  ensureDeptSchema,
  getDepartmentByAdmin,
  listDeptLabHeads,
  recordDeptUsageSnapshot,
  getDeptUsageHistory,
} from "@/lib/billing/dept";
import { ensureLabSchema, listLabMembers } from "@/lib/billing/lab";
import { ensureOpsSchema, opsSince } from "@/lib/billing/ops";
import { getOwnerUsage } from "@/lib/collab/server/db";

export const runtime = "nodejs";

function monthStartISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}
function currentYM(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
async function usedBytes(key: string): Promise<number> {
  try {
    return await getOwnerUsage(key);
  } catch {
    return 0;
  }
}
async function monthWrites(key: string, since: string): Promise<number> {
  try {
    return (await opsSince(key, since)).writes;
  } catch {
    return 0;
  }
}

interface AccountUsage {
  memberKey: string;
  label: string | null;
  isHead: boolean;
  bytes: number;
  syncs: number;
}
interface LabUsage {
  labHeadKey: string;
  label: string | null;
  bytes: number;
  syncs: number;
  accounts: AccountUsage[];
}

export async function GET(): Promise<Response> {
  if (!DEPT_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmail(email);

  try {
    await ensureDeptSchema();
    await ensureLabSchema();
    await ensureOpsSchema();

    const dept = await getDepartmentByAdmin(adminOwnerKey);
    if (!dept) return json(200, { enabled: true, department: null });

    const since = monthStartISO();
    const labHeads = (await listDeptLabHeads(dept.deptId)).filter(
      (h) => h.status === "active",
    );

    const labs: LabUsage[] = [];
    let deptBytes = 0;
    let deptSyncs = 0;

    for (const head of labHeads) {
      const members = await listLabMembers(head.labHeadOwnerKey);
      const activeMembers = members.filter((m) => m.status === "active");
      // The lab's accounts = the head plus their active members.
      const accountKeys: { key: string; label: string | null; isHead: boolean }[] = [
        { key: head.labHeadOwnerKey, label: head.label, isHead: true },
        ...activeMembers.map((m) => ({
          key: m.memberOwnerKey,
          label: m.label,
          isHead: false,
        })),
      ];
      const accounts: AccountUsage[] = [];
      let labBytes = 0;
      let labSyncs = 0;
      for (const a of accountKeys) {
        const bytes = await usedBytes(a.key);
        const syncs = await monthWrites(a.key, since);
        labBytes += bytes;
        labSyncs += syncs;
        accounts.push({ memberKey: a.key, label: a.label, isHead: a.isHead, bytes, syncs });
      }
      deptBytes += labBytes;
      deptSyncs += labSyncs;
      labs.push({
        labHeadKey: head.labHeadOwnerKey,
        label: head.label,
        bytes: labBytes,
        syncs: labSyncs,
        accounts,
      });
    }

    // Opportunistic monthly snapshot so the over-time trend accumulates.
    await recordDeptUsageSnapshot(dept.deptId, currentYM(), deptBytes, deptSyncs);
    const history = await getDeptUsageHistory(dept.deptId, 6);

    return json(200, {
      enabled: true,
      department: { deptId: dept.deptId, name: dept.name },
      totalBytes: deptBytes,
      totalSyncs: deptSyncs,
      labCount: labs.length,
      labs,
      history,
    });
  } catch {
    return json(500, { error: "could not load department usage" });
  }
}
