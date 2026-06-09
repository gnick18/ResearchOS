// Lab directory, join-request endpoints (lab-search-bot, 2026-06-09).
//
// POST /api/directory/labs/request   { labId }
//   Records a "request to join" from the session user for the given lab.
//   Idempotent per (labId, requester). Gated on session + rate limit.
//   Returns { ok: true } on success.
//
// GET /api/directory/labs/request    (no body)
//   Returns all pending join requests for the PI's own lab.
//   The PI's identity is determined from the session email (hashed) matching
//   the pi_email_hash of the lab row. Responds with
//   { requests: LabJoinRequest[] }.
//
// Requires an authenticated session. Gated on LAB_TIER_ENABLED + SHARING_ENABLED.
// No em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import {
  ensureLabsSchema,
  getLabListing,
  upsertLabJoinRequest,
  getPendingJoinRequests,
  getBindingByHash,
  ensureSchema,
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

// ---------------------------------------------------------------------------
// POST -- submit a join request
// ---------------------------------------------------------------------------

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

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).labId !== "string"
  ) {
    return json(400, { error: "invalid request" });
  }

  const labId = ((body as Record<string, unknown>).labId as string).trim();
  if (!labId) {
    return json(400, { error: "labId is required" });
  }

  try {
    await ensureSchema();
    await ensureLabsSchema();

    // Resolve the requester's email hash + display name from their directory
    // binding if available. Fallback to a hashed-only representation.
    const pepper = getPepper();
    const emailHash = hashEmail(canonicalizeEmail(session.user.email), pepper);

    // Look up the requester's binding for their pubkey and display name.
    const binding = await getBindingByHash(emailHash);
    const requesterPubkey = binding?.ed25519PublicKey ?? "";

    // Use the session display name when available, otherwise derive from email.
    const sessionName =
      session.user.name?.trim() ||
      session.user.email.split("@")[0];

    // Verify the lab exists and is listed before storing the request.
    const lab = await getLabListing(labId);
    if (!lab) {
      return json(404, { error: "lab not found" });
    }
    if (!lab.listed) {
      // Treat unlisted labs as not found so they cannot be targeted by enumeration.
      return json(404, { error: "lab not found" });
    }

    await upsertLabJoinRequest({
      labId,
      requesterEmailHash: emailHash,
      requesterPubkey,
      requesterName: sessionName,
    });

    return json(200, { ok: true });
  } catch {
    return json(500, { error: "request failed" });
  }
}

// ---------------------------------------------------------------------------
// GET -- PI fetches pending requests for their lab
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
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

  // Derive the PI's email hash so we can match it against pi_email_hash.
  const pepper = getPepper();
  const piEmailHash = hashEmail(
    canonicalizeEmail(session.user.email),
    pepper,
  );

  const url = new URL(request.url);
  const labId = url.searchParams.get("labId")?.trim();
  if (!labId) {
    return json(400, { error: "labId is required" });
  }

  try {
    await ensureSchema();
    await ensureLabsSchema();

    const lab = await getLabListing(labId);
    if (!lab) {
      return json(404, { error: "lab not found" });
    }
    // Only the lab's own PI can see the requests.
    if (lab.piEmailHash !== piEmailHash) {
      return json(403, { error: "forbidden" });
    }

    const requests = await getPendingJoinRequests(labId);
    return json(200, { requests });
  } catch {
    return json(500, { error: "fetch failed" });
  }
}
