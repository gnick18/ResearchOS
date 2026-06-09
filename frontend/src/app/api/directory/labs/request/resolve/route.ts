// Lab directory, resolve a join request (lab-search-bot, 2026-06-09).
//
// POST /api/directory/labs/request/resolve
//   Body: { labId, requesterEmailHash, action: 'approve' | 'decline' }
//   Session: PI (the session email hash must match the lab's pi_email_hash).
//
// On 'decline': marks the row declined, returns { ok: true }.
// On 'approve': marks the row approved, returns
//   { ok: true, requesterPubkey, requesterName, labName }
//   so the PI's browser can mint a signed invite link (client-side crypto)
//   and optionally email it via the /lab/join route.  The server cannot mint
//   the invite itself because it requires the PI's Ed25519 private key.
//
// Gated on LAB_TIER_ENABLED + SHARING_ENABLED.
// No em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import {
  ensureLabsSchema,
  ensureSchema,
  getLabListing,
  resolveLabJoinRequest,
  getPendingJoinRequests,
} from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!LAB_TIER_ENABLED || !isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return json(401, { error: "unauthorized" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  if (typeof body !== "object" || body === null) {
    return json(400, { error: "invalid request" });
  }
  const b = body as Record<string, unknown>;

  const labId =
    typeof b.labId === "string" ? b.labId.trim() : "";
  const requesterEmailHash =
    typeof b.requesterEmailHash === "string" ? b.requesterEmailHash.trim() : "";
  const action = b.action;

  if (!labId || !requesterEmailHash) {
    return json(400, { error: "labId and requesterEmailHash are required" });
  }
  if (action !== "approve" && action !== "decline") {
    return json(400, { error: "action must be 'approve' or 'decline'" });
  }

  const pepper = getPepper();
  const piEmailHash = hashEmail(
    canonicalizeEmail(session.user.email),
    pepper,
  );

  try {
    await ensureSchema();
    await ensureLabsSchema();

    const lab = await getLabListing(labId);
    if (!lab) {
      return json(404, { error: "lab not found" });
    }
    if (lab.piEmailHash !== piEmailHash) {
      return json(403, { error: "forbidden" });
    }

    // Fetch the request before marking it resolved so we can return the
    // requester's pubkey to the caller on approval.
    const pending = await getPendingJoinRequests(labId);
    const req = pending.find(
      (r) => r.requesterEmailHash === requesterEmailHash,
    );
    if (!req) {
      return json(404, { error: "request not found or already resolved" });
    }

    await resolveLabJoinRequest(labId, requesterEmailHash, action);

    if (action === "decline") {
      return json(200, { ok: true });
    }

    // On approve: return the requester's pubkey + name so the PI's browser
    // can mint a signed invite link client-side (the PI's Ed25519 private key
    // never leaves the browser). The PI's UI should then call mintInviteForHead
    // and share or email the resulting link.
    return json(200, {
      ok: true,
      requesterPubkey: req.requesterPubkey,
      requesterName: req.requesterName,
      labName: lab.name,
    });
  } catch {
    return json(500, { error: "resolve failed" });
  }
}
