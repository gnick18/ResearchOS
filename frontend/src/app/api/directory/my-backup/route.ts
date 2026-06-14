// Cloud-accounts Phase 2, Chunk 2A: the caller's own key-backup blob.
//
// GET, authed by the OAuth session ONLY. Returns the encrypted key_backup_blob
// for the SESSION user's own email hash, and nothing else, ever. This is the
// folderless cross-device restore path: a signed-in user on a new device fetches
// their own backup blob and unwraps it locally with their recovery words (the
// blob is end-to-end encrypted, the server cannot read it).
//
// Unlike /api/directory/recover (POST { email, otp }), this route takes NO email
// from the client. The email comes from the verified session, so a caller can
// only ever retrieve THEIR OWN blob, never anyone else's. 401 when there is no
// session, 404 when the account has no stored blob.
//
// Reads env: SHARING_ENABLED, DIRECTORY_HMAC_PEPPER, DATABASE_URL, plus the
// AUTH_* vars used by the session.

import { auth } from "@/lib/sharing/auth";
import { canonicalizeEmail, hashEmail } from "@/lib/sharing/directory/email";
import { ensureSchema, getBackupBlob } from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // No session, or a session without a verified email, means the caller has not
  // proven they own any address. Generic 401, never say which.
  const session = await auth();
  const sessionEmail = session?.user?.email;
  if (!sessionEmail) {
    return json(401, { error: "unauthorized" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  // The email is the OAuth-verified one from the session, never from the
  // request, so this can only resolve the caller's OWN hash.
  const canonical = canonicalizeEmail(sessionEmail);
  const emailHash = hashEmail(canonical, getPepper());

  await ensureSchema();

  const keyBackupBlob = await getBackupBlob(emailHash);
  if (!keyBackupBlob) {
    // No binding, or a binding with no stored blob. 404 means "nothing to
    // restore for you", the caller never learns which case applied.
    return json(404, { error: "no backup" });
  }

  return json(200, { keyBackupBlob });
}
