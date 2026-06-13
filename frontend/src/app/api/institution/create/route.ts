// Institution tier Phase 4: create an institution (the caller becomes its admin).
// POST /api/institution/create  body { institutionId, name, adminEd25519Pub }
// One institution per admin (idempotent). Dark unless INSTITUTION_TIER_ENABLED.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmail } from "@/lib/billing/owner";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import {
  ensureInstitutionSchema,
  createInstitution,
  getInstitutionByAdmin,
} from "@/lib/billing/institution";

export const runtime = "nodejs";
const HEX = /^[0-9a-f]+$/i;

export async function POST(request: Request): Promise<Response> {
  if (!INSTITUTION_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const adminOwnerKey = ownerKeyForEmail(email);

  let body: { institutionId?: unknown; name?: unknown; adminEd25519Pub?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid json" });
  }
  const institutionId =
    typeof body.institutionId === "string" ? body.institutionId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const pub =
    typeof body.adminEd25519Pub === "string" ? body.adminEd25519Pub.trim() : "";
  if (!institutionId || !name) return json(400, { error: "institutionId and name are required" });
  if (!HEX.test(pub)) return json(400, { error: "a valid admin pubkey is required" });

  try {
    await ensureInstitutionSchema();
    const existing = await getInstitutionByAdmin(adminOwnerKey);
    if (existing) return json(200, { ok: true, institutionId: existing.institutionId, existing: true });
    await createInstitution({ institutionId, name, adminOwnerKey, adminEd25519Pub: pub });
    return json(200, { ok: true, institutionId });
  } catch {
    return json(500, { error: "could not create the institution" });
  }
}
