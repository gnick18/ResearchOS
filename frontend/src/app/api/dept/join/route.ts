// Department tier Phase 1: a lab head accepts a dept invite link.
//
// POST /api/dept/join  body { invite: DeptInvitePayload }
//   The lab head is authenticated (their owner key is derived server-side from
//   the session email). We verify the invite is real: the signer pubkey must
//   match the department record's admin, the signature must verify, and it must
//   not be expired. Then we enroll the lab head as active (org membership; no
//   charging in Phase 1). Idempotent, so a replayed link just re-confirms the
//   same authenticated lab head.
//
// Dark unless DEPT_TIER_ENABLED. Sign-in required.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { ensureDeptSchema, getDepartment, enrollLabHeadActive } from "@/lib/billing/dept";
import {
  verifyDeptInviteSignature,
  isDeptInviteExpired,
  type DeptInvitePayload,
} from "@/lib/dept/dept-invite";

export const runtime = "nodejs";

function asInvite(raw: unknown): DeptInvitePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<DeptInvitePayload>;
  if (
    typeof p.deptId !== "string" ||
    typeof p.adminEd25519Pub !== "string" ||
    typeof p.nonce !== "string" ||
    typeof p.sig !== "string" ||
    typeof p.expiresAt !== "number" ||
    typeof p.deptName !== "string" ||
    typeof p.adminUsername !== "string"
  ) {
    return null;
  }
  return p as DeptInvitePayload;
}

export async function POST(request: Request): Promise<Response> {
  if (!DEPT_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const labHeadOwnerKey = ownerKeyForEmail(email);

  let body: { invite?: unknown };
  try {
    body = (await request.json()) as { invite?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const invite = asInvite(body.invite);
  if (!invite) return json(400, { error: "malformed invite" });

  try {
    await ensureDeptSchema();
    const dept = await getDepartment(invite.deptId);
    if (!dept) return json(404, { error: "department not found" });
    // Cross-check the signer against the real admin pubkey, THEN verify the sig.
    if (invite.adminEd25519Pub !== dept.adminEd25519Pub) {
      return json(403, { error: "invite was not signed by this department's admin" });
    }
    if (!verifyDeptInviteSignature(invite)) {
      return json(403, { error: "invalid invite signature" });
    }
    if (isDeptInviteExpired(invite, Date.now())) {
      return json(410, { error: "this invite has expired" });
    }
    // Label with the lab head's own email so the admin's roster is readable (the
    // dept admin is the payer; per the locked visibility model they see names).
    await enrollLabHeadActive(invite.deptId, labHeadOwnerKey, email);
    return json(200, { ok: true, deptName: dept.name });
  } catch {
    return json(500, { error: "could not join the department" });
  }
}
