// Network feed + follow graph API (social lane, Build 2).
//
//   GET    /api/social/network         -> { feed: FeedEventCard[], suggestions: FollowSuggestion[] }
//   POST   /api/social/network/follow  -> { ok: true }
//   DELETE /api/social/network/follow  -> { ok: true }
//
// All routes:
//   - 404 when isNetworkFeedEnabled() is false (inert until the flag flips)
//   - 401 when the caller has no session (resolveCallerOwnerKey returns null)
//
// Auth pattern mirrors app/api/social/lab-site/route.ts exactly.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isNetworkFeedEnabled } from "@/lib/social/config";
import { json } from "@/lib/social/guard";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import {
  ensureNetworkFeedSchema,
  getNetworkFeed,
  getFollowSuggestions,
} from "@/lib/social/network-feed-db";

export const runtime = "nodejs";

export async function GET(_request: Request): Promise<Response> {
  if (!isNetworkFeedEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  if (!callerOwnerKey) return json(401, { error: "unauthorized" });

  try {
    await ensureNetworkFeedSchema();
    const [feed, suggestions] = await Promise.all([
      getNetworkFeed(callerOwnerKey),
      getFollowSuggestions(callerOwnerKey),
    ]);
    return json(200, { feed, suggestions });
  } catch (err) {
    console.error("[api/social/network] GET failed:", err);
    return json(503, { error: "feed unavailable" });
  }
}
