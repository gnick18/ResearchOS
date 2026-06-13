// Institution tier Phase 4: a department admin accepts an institution invite.
// POST /api/institution/join  body { invite: InstitutionInvitePayload }
//   The accepter must run a department (they are its admin); accepting links THAT
//   department to the institution. We verify the invite signer is the institution's
//   admin + the signature + expiry, resolve the accepter's department, then enroll
//   it active. Org only (no charging in Phase 4).
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
  verifyInstitutionInviteSignature,
  isInstitutionInviteExpired,
  type InstitutionInvitePayload,
} from "@/lib/institution/institution-invite";

export const runtime = "nodejs";

function asInvite(raw: unknown): InstitutionInvitePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<InstitutionInvitePayload>;
  if (
    typeof p.institutionId !== "string" ||
    typeof p.adminEd25519Pub !== "string" ||
    typeof p.nonce !== "string" ||
    typeof p.sig !== "string" ||
    typeof p.expiresAt !== "number" ||
    typeof p.institutionName !== "string" ||
    typeof p.adminUsername !== "string"
  ) {
    return null;
  }
  return p as InstitutionInvitePayload;
}

export async function POST(request: Request): Promise<Response> {
  if (!INSTITUTION_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const callerKey = ownerKeyForEmailSafe(email);
  if (!callerKey) return json(503, { error: "billing identity unavailable" });

  let body: { invite?: unknown };
  try {
    body = (await request.json()) as { invite?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const invite = asInvite(body.invite);
  if (!invite) return json(400, { error: "malformed invite" });

  try {
    await ensureInstitutionSchema();
    await ensureDeptSchema();

    const inst = await getInstitution(invite.institutionId);
    if (!inst) return json(404, { error: "institution not found" });
    if (invite.adminEd25519Pub !== inst.adminEd25519Pub) {
      return json(403, { error: "invite was not signed by this institution's admin" });
    }
    if (!verifyInstitutionInviteSignature(invite)) {
      return json(403, { error: "invalid invite signature" });
    }
    if (isInstitutionInviteExpired(invite, Date.now())) {
      return json(410, { error: "this invite has expired" });
    }
    // The accepter must run a department; that department joins the institution.
    const dept = await getDepartmentByAdmin(callerKey);
    if (!dept) {
      return json(409, {
        error: "create a department first, then accept this invitation",
        needsDepartment: true,
      });
    }
    await enrollDeptActive(invite.institutionId, dept.deptId, dept.name);
    return json(200, { ok: true, institutionName: inst.name, deptName: dept.name });
  } catch {
    return json(500, { error: "could not join the institution" });
  }
}
