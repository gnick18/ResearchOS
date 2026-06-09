// Lab directory, publish-on-create endpoint (lab-search-bot, 2026-06-09).
//
// POST /api/directory/labs/publish
//   Body: { labId, name, institution?, piDisplayName }
//   Called by createLabForCurrentUser (best-effort) right after the relay
//   accepts the genesis record. Creates a directory_labs row with listed=false.
//   The PI can later opt into the public listing via the setLabListed endpoint.
//
// Also handles the listed-toggle:
// PATCH /api/directory/labs/publish
//   Body: { labId, listed: boolean }
//   Sets the listed flag. Only the PI (pi_email_hash must match session) can
//   change it.
//
// Gated on LAB_TIER_ENABLED + SHARING_ENABLED.
// No em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import {
  ensureLabsSchema,
  ensureSchema,
  upsertLabListing,
  setLabListed,
  getLabListing,
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
// POST -- upsert a lab directory row (called on lab creation, listed=false)
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

  if (typeof body !== "object" || body === null) {
    return json(400, { error: "invalid request" });
  }
  const b = body as Record<string, unknown>;

  const labId = typeof b.labId === "string" ? b.labId.trim() : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const institution =
    typeof b.institution === "string" ? b.institution.trim() || null : null;
  const piDisplayName =
    typeof b.piDisplayName === "string"
      ? b.piDisplayName.trim()
      : session.user.name?.trim() || session.user.email.split("@")[0];

  if (!labId || !name) {
    return json(400, { error: "labId and name are required" });
  }

  const pepper = getPepper();
  const piEmailHash = hashEmail(canonicalizeEmail(session.user.email), pepper);

  try {
    await ensureSchema();
    await ensureLabsSchema();
    await upsertLabListing({
      labId,
      name,
      institution,
      piEmailHash,
      piDisplayName,
      memberCount: 1,
    });
    return json(200, { ok: true });
  } catch {
    return json(500, { error: "publish failed" });
  }
}

// ---------------------------------------------------------------------------
// PATCH -- toggle the listed flag for a lab (PI only)
// ---------------------------------------------------------------------------

export async function PATCH(request: Request): Promise<Response> {
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

  const labId = typeof b.labId === "string" ? b.labId.trim() : "";
  const listed = b.listed;

  if (!labId || typeof listed !== "boolean") {
    return json(400, { error: "labId and listed (boolean) are required" });
  }

  const pepper = getPepper();
  const piEmailHash = hashEmail(canonicalizeEmail(session.user.email), pepper);

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

    await setLabListed(labId, listed);
    return json(200, { ok: true });
  } catch {
    return json(500, { error: "update failed" });
  }
}
