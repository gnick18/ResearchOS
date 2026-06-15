// Department tier Phase 1: create a department (the caller becomes its admin).
//
// POST /api/dept/create  body { deptId, name, adminEd25519Pub }
//   The admin_owner_key is derived SERVER-SIDE from the authenticated session
//   email, never trusted from the body. adminEd25519Pub is the admin's signing
//   pubkey, stored so the dept-join route can verify the invites they later mint.
//
// One department per admin in Phase 1 (idempotent: a second call returns the
// existing dept). Dark unless DEPT_TIER_ENABLED. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import {
  ensureDeptSchema,
  createDepartment,
  getDepartmentByAdmin,
} from "@/lib/billing/dept";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!DEPT_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmailSafe(email);
  if (!adminOwnerKey) return json(503, { error: "billing identity unavailable" });

  let body: { deptId?: unknown; name?: unknown; adminEd25519Pub?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }
  const deptId = typeof body.deptId === "string" ? body.deptId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  // adminEd25519Pub is now vestigial: invites are server-issued opaque tokens
  // (no client signature), so no admin signing key is needed. Accepted if a
  // legacy client still sends one, otherwise stored empty.
  const pub =
    typeof body.adminEd25519Pub === "string" ? body.adminEd25519Pub.trim() : "";
  if (!deptId || !name) return json(400, { error: "deptId and name are required" });

  try {
    await ensureDeptSchema();
    // One dept per admin (Phase 1): return the existing one rather than spawn a
    // second, so a double-submit or a re-entry is idempotent.
    const existing = await getDepartmentByAdmin(adminOwnerKey);
    if (existing) {
      return json(200, { ok: true, deptId: existing.deptId, existing: true });
    }
    await createDepartment({ deptId, name, adminOwnerKey, adminEd25519Pub: pub });
    return json(200, { ok: true, deptId });
  } catch {
    return json(500, { error: "could not create the department" });
  }
}
