// Lab tier Phase 4B: a member joins a lab (unified server-token membership).
//
// POST /api/lab/join  body { token }
//   The member is authenticated (owner key derived server-side from the session
//   email). We atomically validate + single-use-redeem the opaque token for layer
//   "lab" (the server is the trust anchor, no device key), then enroll the member
//   as ACTIVE in the lab's shared billing pool keyed by the head's owner key
//   (token.createdBy). A spent or expired token returns a precise error so the
//   accept screen can ask for a fresh link.
//
//   This makes the caller a MEMBER. It does NOT grant data access. The lab DATA
//   KEY is end-to-end and never touches the server; it is sealed to the member
//   later by a labmate who already holds it (Phase 4A deferred sealing), once the
//   member has a published X25519 pubkey. So a freshly joined account-first member
//   is "a member, data key pending" until that seal lands, which the UI shows
//   plainly (never a silent failure, never a soft-lock).
//
// Dark unless LAB_TOKENS_V2 is enabled. Sign-in required.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import { json } from "@/lib/sharing/directory/guard";
import { ownerKeyForEmailSafe } from "@/lib/billing/owner";
import { isLabTokensV2Enabled } from "@/lib/lab/lab-tokens-config";
import { ensureLabSchema, enrollMemberActive } from "@/lib/billing/lab";
import {
  ensureInviteSchema,
  redeemInvite,
  redeemErrorMessage,
} from "@/lib/invites/invite-tokens";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isLabTokensV2Enabled()) return json(404, { error: "not found" });

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return json(401, { error: "sign in required" });
  const memberOwnerKey = ownerKeyForEmailSafe(email);
  if (!memberOwnerKey) return json(503, { error: "billing identity unavailable" });

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
    await ensureLabSchema();
    const redeemed = await redeemInvite({ token, layer: "lab", usedBy: memberOwnerKey });
    if (!redeemed.ok) {
      const status =
        redeemed.reason === "expired" || redeemed.reason === "already_used" ? 410 : 400;
      return json(status, { error: redeemErrorMessage(redeemed.reason) });
    }
    // The head who minted the token (createdBy) is the lab's billing owner. A head
    // cannot be their own member; enrollMemberActive no-ops that case.
    const labOwnerKey = redeemed.createdBy;
    // Label the roster row with the member's own email so the head's roster is
    // readable (the head already possesses invited members' addresses).
    await enrollMemberActive(labOwnerKey, memberOwnerKey, email);
    // entityId is the cryptographic labId; the member uses it to poll for their
    // sealed data-key copy (Phase 4A) once a labmate seals to them.
    return json(200, { ok: true, labId: redeemed.entityId });
  } catch {
    return json(500, { error: "could not join the lab" });
  }
}
