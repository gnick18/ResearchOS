// Department tier: a lab head accepts a dept invite (unified server-token).
//
// POST /api/dept/join  body { token }
//   The lab head is authenticated (owner key derived server-side from the
//   session email). We atomically validate + single-use-redeem the opaque token
//   for layer "dept" (the server is the trust anchor, no client signature), then
//   enroll the lab head as active. A spent or expired token returns a precise
//   error so the accept screen can ask for a fresh link.
//
// Dark unless DEPT_TIER_ENABLED. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { ensureDeptSchema, getDepartment, enrollLabHeadActive } from "@/lib/billing/dept";
import {
  ensureInviteSchema,
  redeemInvite,
  redeemErrorMessage,
} from "@/lib/invites/invite-tokens";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!DEPT_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const labHeadOwnerKey = ownerKeyForEmailSafe(email);
  if (!labHeadOwnerKey) return json(503, { error: "billing identity unavailable" });

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
    await ensureDeptSchema();
    const redeemed = await redeemInvite({ token, layer: "dept", usedBy: labHeadOwnerKey });
    if (!redeemed.ok) {
      const status =
        redeemed.reason === "expired" || redeemed.reason === "already_used" ? 410 : 400;
      return json(status, { error: redeemErrorMessage(redeemed.reason) });
    }
    const dept = await getDepartment(redeemed.entityId);
    if (!dept) return json(404, { error: "department not found" });
    // Label with the lab head's own email so the admin's roster is readable (the
    // dept admin is the payer; per the locked visibility model they see names).
    await enrollLabHeadActive(redeemed.entityId, labHeadOwnerKey, email);
    return json(200, { ok: true, deptName: dept.name });
  } catch {
    return json(500, { error: "could not join the department" });
  }
}
