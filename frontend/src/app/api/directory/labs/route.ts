// Lab directory, browse endpoint (lab-search-bot, 2026-06-09).
//
// GET /api/directory/labs?q=<query>
//
// Returns up to 20 listed labs whose name or institution case-insensitively
// contains the query string. Gated on LAB_TIER_ENABLED + SHARING_ENABLED.
// Requires an authenticated session (same gate as /api/directory/search).
//
// Returns { labs: LabListingPublic[] } -- never returns unlisted labs.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { auth } from "@/lib/sharing/auth";
import {
  ensureLabsSchema,
  searchListedLabs,
} from "@/lib/sharing/directory/db";
import { getIpLimiter } from "@/lib/sharing/directory/ratelimit";
import {
  extractClientIp,
  isSharingEnabled,
  json,
} from "@/lib/sharing/directory/guard";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!LAB_TIER_ENABLED || !isSharingEnabled()) {
    return json(404, { error: "not found" });
  }

  // Require an authenticated session. Anonymous browse is not allowed.
  const session = await auth();
  if (!session?.user?.email && !session?.orcidId) {
    return json(401, { error: "unauthorized" });
  }

  const ip = extractClientIp(request.headers);
  const ipVerdict = await getIpLimiter().limit(ip);
  if (!ipVerdict.success) {
    return json(429, { error: "rate limited" });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length < 2) {
    return json(400, { error: "query too short" });
  }
  if (q.length > 200) {
    return json(400, { error: "query too long" });
  }

  try {
    await ensureLabsSchema();
    const labs = await searchListedLabs(q, 20);
    return json(200, { labs });
  } catch {
    return json(500, { error: "search failed" });
  }
}
