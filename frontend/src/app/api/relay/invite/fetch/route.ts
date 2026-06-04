// Cross-boundary sharing, relay INVITE fetch route (invite-a-non-user loop).
//
// POST an inviteId, get a short-lived presigned GET URL for the sealed bytes.
// This route is the keyless half of the invite flow, the recipient has NO
// ResearchOS identity yet, so there is no Ed25519 key to sign with. The inviteId
// IS the bearer capability (it came in the accept link the recipient received by
// email), and the one-time decryption key lives only in that link's fragment, so
// holding the inviteId lets you DOWNLOAD the opaque sealed bytes but NOT read
// them without the fragment key. That is the inherent keyless-invite trust model
// stated in the design, the email is the trust channel.
//
// A still-"pending" (un-uploaded) invite reads as absent. An expired invite is
// swept (R2 object + row deleted) and reported 410 Gone. The relay never reads
// the bytes. The per-IP rate limit bounds brute-force guessing of inviteIds
// (which are UUIDv4, so guessing is already infeasible).
//
// Reads env: SHARING_ENABLED, DATABASE_URL, KV_REST_API_URL, KV_REST_API_TOKEN,
// R2_*.

import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import {
  deleteInviteEntry,
  ensureInviteSchema,
  getInviteEntry,
} from "@/lib/sharing/relay/db";
import { deleteObject, presignDownload } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "invite fetch failed" } as const;

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
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

  const inviteId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).inviteId
      : undefined;
  if (!nonEmptyString(inviteId)) {
    return json(400, GENERIC_FAILURE);
  }

  await ensureInviteSchema();

  const entry = await getInviteEntry(inviteId);
  // A non-existent, pending, or already-accepted invite all read as absent here.
  if (!entry) {
    return json(404, { error: "invite not found" });
  }

  // Expired invite, sweep it (delete the object and the row) and report 410.
  if (new Date(entry.expiresAt).getTime() <= Date.now()) {
    await deleteObject(entry.inviteId);
    await deleteInviteEntry(entry.inviteId);
    return json(410, { error: "invite expired" });
  }

  const downloadUrl = await presignDownload(entry.inviteId);
  return json(200, { downloadUrl });
}
