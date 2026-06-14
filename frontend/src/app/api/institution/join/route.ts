// Institution tier: a department admin accepts an institution invite (unified
// server-token invites).
//
// POST /api/institution/join  body { token }
//   The accepter must run a department (they are its admin); accepting links THAT
//   department to the institution. We atomically validate + single-use-redeem the
//   opaque token for layer "institution" (server is the trust anchor), resolve the
//   accepter's department, then enroll it active. Org only (no charging here).
//
// Dark unless INSTITUTION_TIER_ENABLED. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import {
  ensureInstitutionSchema,
  getInstitution,
  enrollDeptActive,
} from "@/lib/billing/institution";
import { ensureDeptSchema, getDepartmentByAdmin } from "@/lib/billing/dept";
import {
  ensureInviteSchema,
  redeemInvite,
  redeemErrorMessage,
} from "@/lib/invites/invite-tokens";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!INSTITUTION_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const callerKey = ownerKeyForEmailSafe(email);
  if (!callerKey) return json(503, { error: "billing identity unavailable" });

  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return json(400, { error: "missing invite token" });

  try {
    await ensureInviteSchema();
    await ensureInstitutionSchema();
    await ensureDeptSchema();

    // The accepter must run a department FIRST; check before spending the token.
    const dept = await getDepartmentByAdmin(callerKey);
    if (!dept) {
      return json(409, {
        error: "create a department first, then accept this invitation",
        needsDepartment: true,
      });
    }
    const redeemed = await redeemInvite({
      token,
      layer: "institution",
      usedBy: callerKey,
    });
    if (!redeemed.ok) {
      const status =
        redeemed.reason === "expired" || redeemed.reason === "already_used" ? 410 : 400;
      return json(status, { error: redeemErrorMessage(redeemed.reason) });
    }
    const inst = await getInstitution(redeemed.entityId);
    if (!inst) return json(404, { error: "institution not found" });
    await enrollDeptActive(redeemed.entityId, dept.deptId, dept.name);
    return json(200, { ok: true, institutionName: inst.name, deptName: dept.name });
  } catch {
    return json(500, { error: "could not join the institution" });
  }
}
