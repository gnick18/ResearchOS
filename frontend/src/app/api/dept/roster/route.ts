// Department tier Phase 1: the dept admin's lab-head roster.
//
// GET /api/dept/roster
//   Resolves the caller's department (they are its admin, keyed by their session
//   email's owner key) and returns the lab heads who have joined + their status.
//   Returns { department: null } when the caller administers no department.
//
// Dark unless DEPT_TIER_ENABLED. Sign-in required. Read-only.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import {
  ensureDeptSchema,
  getDepartmentByAdmin,
  listDeptLabHeads,
} from "@/lib/billing/dept";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!DEPT_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmailSafe(email);
  if (!adminOwnerKey) return json(503, { error: "billing identity unavailable" });

  try {
    await ensureDeptSchema();
    const dept = await getDepartmentByAdmin(adminOwnerKey);
    if (!dept) return json(200, { enabled: true, department: null });
    const roster = await listDeptLabHeads(dept.deptId);
    return json(200, {
      enabled: true,
      department: { deptId: dept.deptId, name: dept.name },
      labHeads: roster.map((r) => ({
        memberKey: r.labHeadOwnerKey,
        label: r.label,
        status: r.status,
      })),
    });
  } catch {
    return json(500, { error: "could not load the department roster" });
  }
}
