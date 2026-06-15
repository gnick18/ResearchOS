// Department tier: mint + peek a lab-head invite (unified server-token invites).
//
// POST /api/dept/invite  body { deptId }
//   Authenticated. Only the department's own admin (session-derived owner key ==
//   the dept's admin_owner_key) may mint. Issues an opaque server token for
//   layer "dept"; the client builds the /dept/join#<token> link. No device key,
//   no client signature: the server is the trust anchor (centralized org model).
//
// GET /api/dept/invite?token=...
//   Read-only peek for the accept screen to show WHAT the link grants (the
//   department name + whether it is still valid) before the recipient signs in.
//   No auth: the token itself is the capability.
//
// Dark unless DEPT_TIER_ENABLED.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { ensureDeptSchema, getDepartment } from "@/lib/billing/dept";
import {
  ensureInviteSchema,
  issueInvite,
  peekInvite,
} from "@/lib/invites/invite-tokens";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!DEPT_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "billing identity unavailable" });

  let body: { deptId?: unknown };
  try {
    body = (await request.json()) as { deptId?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const deptId = typeof body.deptId === "string" ? body.deptId.trim() : "";
  if (!deptId) return json(400, { error: "deptId is required" });

  try {
    await ensureDeptSchema();
    await ensureInviteSchema();
    const dept = await getDepartment(deptId);
    if (!dept) return json(404, { error: "department not found" });
    if (dept.adminOwnerKey !== ownerKey) {
      return json(403, { error: "only the department admin can mint invites" });
    }
    const { token, expiresAt } = await issueInvite({
      layer: "dept",
      entityId: deptId,
      createdBy: ownerKey,
    });
    return json(200, { ok: true, token, expiresAt });
  } catch {
    return json(500, { error: "could not mint the invite" });
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!DEPT_TIER_ENABLED) return json(404, { error: "not found" });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return json(400, { error: "token is required" });

  try {
    await ensureInviteSchema();
    const invite = await peekInvite(token);
    if (!invite || invite.layer !== "dept") {
      return json(200, { ok: false });
    }
    await ensureDeptSchema();
    const dept = await getDepartment(invite.entityId);
    if (!dept) return json(200, { ok: false });
    return json(200, {
      ok: true,
      deptName: dept.name,
      expired: Date.now() >= invite.expiresAt,
      used: invite.usedAt !== null,
    });
  } catch {
    return json(500, { error: "could not read the invite" });
  }
}
