// Institution tier Phase 4: the institution admin's department roster.
// GET /api/institution/roster -> { institution, depts:[{deptId,label,status}] }
// Dark unless INSTITUTION_TIER_ENABLED. Sign-in required. Read-only.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import {
  ensureInstitutionSchema,
  getInstitutionByAdmin,
  listInstitutionDepts,
} from "@/lib/billing/institution";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!INSTITUTION_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmailSafe(email);
  if (!adminOwnerKey) return json(503, { error: "billing identity unavailable" });

  try {
    await ensureInstitutionSchema();
    const inst = await getInstitutionByAdmin(adminOwnerKey);
    if (!inst) return json(200, { enabled: true, institution: null });
    const depts = await listInstitutionDepts(inst.institutionId);
    return json(200, {
      enabled: true,
      institution: { institutionId: inst.institutionId, name: inst.name },
      depts: depts.map((d) => ({ deptId: d.deptId, label: d.label, status: d.status })),
    });
  } catch {
    return json(500, { error: "could not load the institution roster" });
  }
}
