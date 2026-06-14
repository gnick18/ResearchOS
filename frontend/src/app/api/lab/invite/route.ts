// Lab tier Phase 4B: mint + peek a lab-member invite (unified server-token).
//
// POST /api/lab/invite  body { labId }
//   Authenticated. The signed-in caller is the lab head; their session-derived
//   owner key is recorded as the token's createdBy and becomes the lab's billing
//   owner on join (the lab is addressed cryptographically by labId, billing
//   membership is keyed by the head's owner key). Issues an opaque server token
//   for layer "lab". No device key, no client signature: the server is the trust
//   anchor (same centralized model as dept + institution). The client builds the
//   /lab/join#<token> link.
//
// GET /api/lab/invite?token=...
//   Read-only peek for the accept screen to show that the link is a valid,
//   unspent lab invite before the recipient signs in. No auth: the token itself
//   is the capability. We deliberately do NOT echo the labId here (it is the
//   cryptographic lab address and stays out of an unauthenticated read).
//
// Dark unless LAB_TOKENS_V2 is enabled. Sign-in required to mint.
//
// IMPORTANT: this path mints MEMBERSHIP only. It never touches the lab DATA KEY,
// which stays end-to-end and is sealed to the member later (Phase 4A), client
// side, by a labmate who already holds it. The server never sees the lab key.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { isLabTokensV2Enabled } from "@/lib/lab/lab-tokens-config";
import {
  ensureInviteSchema,
  issueInvite,
  peekInvite,
} from "@/lib/invites/invite-tokens";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isLabTokensV2Enabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const headOwnerKey = ownerKeyForEmailSafe(email);
  if (!headOwnerKey) return json(503, { error: "billing identity unavailable" });

  let body: { labId?: unknown };
  try {
    body = (await request.json()) as { labId?: unknown };
  } catch {
    return json(400, { error: "invalid json" });
  }
  const labId = typeof body.labId === "string" ? body.labId.trim() : "";
  if (!labId) return json(400, { error: "labId is required" });

  try {
    await ensureInviteSchema();
    const { token, expiresAt } = await issueInvite({
      layer: "lab",
      entityId: labId,
      createdBy: headOwnerKey,
    });
    return json(200, { ok: true, token, expiresAt });
  } catch {
    return json(500, { error: "could not mint the invite" });
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!isLabTokensV2Enabled()) return json(404, { error: "not found" });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return json(400, { error: "token is required" });

  try {
    await ensureInviteSchema();
    const invite = await peekInvite(token);
    if (!invite || invite.layer !== "lab") {
      return json(200, { ok: false });
    }
    return json(200, {
      ok: true,
      expired: Date.now() >= invite.expiresAt,
      used: invite.usedAt !== null,
    });
  } catch {
    return json(500, { error: "could not read the invite" });
  }
}
