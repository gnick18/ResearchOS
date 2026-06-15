// Cloud-accounts Phase 1 (Chunk B): public account-profile lookup by @handle.
//
// GET /api/account/public?handle=<handle>
//   No auth. Resolves a handle to its public profile (handle + display name +
//   affiliation) for the /u/<handle> page. Also doubles as an availability check
//   (found = taken). Reveals only the public profile fields, never the owner key.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { json } from "@/lib/sharing/directory/guard";
import {
  ensureAccountProfileSchema,
  getAccountProfileByHandle,
  normalizeHandle,
} from "@/lib/account/account-profile";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const handle = normalizeHandle(
    new URL(request.url).searchParams.get("handle") ?? "",
  );
  if (!handle) return json(400, { error: "handle is required" });

  try {
    await ensureAccountProfileSchema();
    const profile = await getAccountProfileByHandle(handle);
    if (!profile) return json(200, { found: false });
    return json(200, { found: true, profile });
  } catch {
    return json(500, { error: "could not read the profile" });
  }
}
