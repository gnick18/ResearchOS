// Cross-boundary sharing, relay INVITE ack route (invite-a-non-user loop).
//
// POST an inviteId to acknowledge pickup, which deletes the sealed R2 object and
// the pending-invite metadata row (delete-on-pickup, same as a normal share).
// Like the invite fetch route this is keyless and bearer-by-inviteId, the
// recipient is mid-claim (their identity may be brand new) and the inviteId is
// the capability they hold from the accept link.
//
// ACK-AFTER-FILE. The accept page calls this ONLY after the decrypted note is
// safely written into the new user's folder via importNoteBundle, so a crash
// between download and local write leaves the invite on the relay to retry. R2
// delete is idempotent, so a double-ack is harmless.
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
} from "@/lib/sharing/relay/db";
import { deleteObject } from "@/lib/sharing/relay/storage";

export const runtime = "nodejs";

const GENERIC_FAILURE = { error: "invite ack failed" } as const;

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

  // Delete the object then the row. Both are idempotent, so an ack against an
  // already-swept or already-accepted invite is a harmless no-op that still
  // returns ok (the recipient's intent, "remove this", is satisfied either way).
  await deleteObject(inviteId);
  await deleteInviteEntry(inviteId);

  return json(200, { ok: true });
}
