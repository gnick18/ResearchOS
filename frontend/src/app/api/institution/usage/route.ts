// Institution tier Phase 4c: usage rolled up institution -> depts -> labs.
// GET /api/institution/usage. Per-dept and per-lab totals (storage + this-month
// activity), institution totals, monthly history (opportunistic snapshot). The
// institution admin sees the dept + lab roll-up, never research data.
//
// Dark unless INSTITUTION_TIER_ENABLED. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import {
  ensureInstitutionSchema,
  getInstitutionByAdmin,
  listInstitutionDepts,
  recordInstitutionUsageSnapshot,
  getInstitutionUsageHistory,
} from "@/lib/billing/institution";
import { ensureDeptSchema, getDepartment, listDeptLabHeads } from "@/lib/billing/dept";
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
async function bytesOf(key: string): Promise<number> {
  try {
    return await getOwnerUsage(key);
  } catch {
    return 0;
  }
}
async function writesOf(key: string, since: string): Promise<number> {
  try {
    return (await opsSince(key, since)).writes;
  } catch {
    return 0;
  }
}

interface LabRoll {
  labHeadKey: string;
  label: string | null;
  bytes: number;
  syncs: number;
}
interface DeptRoll {
  deptId: string;
  name: string | null;
  bytes: number;
  syncs: number;
  labs: LabRoll[];
}

export async function GET(): Promise<Response> {
  if (!INSTITUTION_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmail(email);

  try {
    await ensureInstitutionSchema();
    await ensureDeptSchema();
    await ensureLabSchema();
    await ensureOpsSchema();

    const inst = await getInstitutionByAdmin(adminOwnerKey);
    if (!inst) return json(200, { enabled: true, institution: null });

    const since = monthStartISO();
    const memberDepts = (await listInstitutionDepts(inst.institutionId)).filter(
      (d) => d.status === "active",
    );

    const depts: DeptRoll[] = [];
    let instBytes = 0;
    let instSyncs = 0;
    let totalLabs = 0;

    for (const md of memberDepts) {
      const deptRecord = await getDepartment(md.deptId);
      const heads = (await listDeptLabHeads(md.deptId)).filter((h) => h.status === "active");
      const labs: LabRoll[] = [];
      let deptBytes = 0;
      let deptSyncs = 0;
      for (const head of heads) {
        const members = (await listLabMembers(head.labHeadOwnerKey)).filter(
          (m) => m.status === "active",
        );
        const keys = [head.labHeadOwnerKey, ...members.map((m) => m.memberOwnerKey)];
        let labBytes = 0;
        let labSyncs = 0;
        for (const k of keys) {
          labBytes += await bytesOf(k);
          labSyncs += await writesOf(k, since);
        }
        deptBytes += labBytes;
        deptSyncs += labSyncs;
        labs.push({
          labHeadKey: head.labHeadOwnerKey,
          label: head.label,
          bytes: labBytes,
          syncs: labSyncs,
        });
      }
      totalLabs += labs.length;
      instBytes += deptBytes;
      instSyncs += deptSyncs;
      depts.push({
        deptId: md.deptId,
        name: deptRecord?.name ?? md.label,
        bytes: deptBytes,
        syncs: deptSyncs,
        labs,
      });
    }

    await recordInstitutionUsageSnapshot(inst.institutionId, currentYM(), instBytes, instSyncs);
    const history = await getInstitutionUsageHistory(inst.institutionId, 6);

    return json(200, {
      enabled: true,
      institution: { institutionId: inst.institutionId, name: inst.name },
      totalBytes: instBytes,
      totalSyncs: instSyncs,
      deptCount: depts.length,
      labCount: totalLabs,
      depts,
      history,
    });
  } catch {
    return json(500, { error: "could not load institution usage" });
  }
}
