// Institution tier: mint + peek a dept-admin invite (unified server-token invites).
//
// POST /api/institution/invite  body { institutionId }
//   Authenticated. Only the institution's own admin (session-derived owner key ==
//   the institution's admin_owner_key) may mint. Issues an opaque server token for
//   layer "institution"; the client builds the /institution/join#<token> link.
//
// GET /api/institution/invite?token=...
//   Read-only peek for the accept screen to show the institution name + validity
//   before the recipient signs in. No auth: the token itself is the capability.
//
// Dark unless INSTITUTION_TIER_ENABLED.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import { ensureInstitutionSchema, getInstitution } from "@/lib/billing/institution";
import {
  ensureInviteSchema,
  issueInvite,
  peekInvite,
} from "@/lib/invites/invite-tokens";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!INSTITUTION_TIER_ENABLED) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const ownerKey = ownerKeyForEmailSafe(email);
  if (!ownerKey) return json(503, { error: "billing identity unavailable" });

  let body: { institutionId?: unknown };
  try {
    body = (await request.json()) as { institutionId?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const institutionId =
    typeof body.institutionId === "string" ? body.institutionId.trim() : "";
  if (!institutionId) return json(400, { error: "institutionId is required" });

  try {
    await ensureInstitutionSchema();
    await ensureInviteSchema();
    const inst = await getInstitution(institutionId);
    if (!inst) return json(404, { error: "institution not found" });
    if (inst.adminOwnerKey !== ownerKey) {
      return json(403, { error: "only the institution admin can mint invites" });
    }
    const { token, expiresAt } = await issueInvite({
      layer: "institution",
      entityId: institutionId,
      createdBy: ownerKey,
    });
    return json(200, { ok: true, token, expiresAt });
  } catch {
    return json(500, { error: "could not mint the invite" });
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!INSTITUTION_TIER_ENABLED) return json(404, { error: "not found" });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return json(400, { error: "token is required" });

  try {
    await ensureInviteSchema();
    const invite = await peekInvite(token);
    if (!invite || invite.layer !== "institution") {
      return json(200, { ok: false });
    }
    await ensureInstitutionSchema();
    const inst = await getInstitution(invite.entityId);
    if (!inst) return json(200, { ok: false });
    return json(200, {
      ok: true,
      institutionName: inst.name,
      expired: Date.now() >= invite.expiresAt,
      used: invite.usedAt !== null,
    });
  } catch {
    return json(500, { error: "could not read the invite" });
  }
}
