// Follow / unfollow route (social lane, Build 2).
//
//   POST   /api/social/network/follow  body { followeeOwnerKey: string }
//   DELETE /api/social/network/follow  body { followeeOwnerKey: string }
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isNetworkFeedEnabled } from "@/lib/social/config";
import { json } from "@/lib/social/guard";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import {
  ensureNetworkFeedSchema,
  followResearcher,
  unfollowResearcher,
} from "@/lib/social/network-feed-db";

export const runtime = "nodejs";

async function resolveBody(
  request: Request,
): Promise<{ followeeOwnerKey: string } | null> {
  try {
    const body = (await request.json()) as { followeeOwnerKey?: unknown };
    if (typeof body.followeeOwnerKey !== "string" || !body.followeeOwnerKey.trim()) {
      return null;
    }
    return { followeeOwnerKey: body.followeeOwnerKey.trim() };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isNetworkFeedEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  if (!callerOwnerKey) return json(401, { error: "unauthorized" });

  const body = await resolveBody(request);
  if (!body) return json(400, { error: "followeeOwnerKey required" });

  if (body.followeeOwnerKey === callerOwnerKey) {
    return json(400, { error: "cannot follow yourself" });
  }

  try {
    await ensureNetworkFeedSchema();
    await followResearcher(callerOwnerKey, body.followeeOwnerKey);
    return json(200, { ok: true });
  } catch (err) {
    console.error("[api/social/network/follow] POST failed:", err);
    return json(503, { error: "follow unavailable" });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isNetworkFeedEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  if (!callerOwnerKey) return json(401, { error: "unauthorized" });

  const body = await resolveBody(request);
  if (!body) return json(400, { error: "followeeOwnerKey required" });

  try {
    await ensureNetworkFeedSchema();
    await unfollowResearcher(callerOwnerKey, body.followeeOwnerKey);
    return json(200, { ok: true });
  } catch (err) {
    console.error("[api/social/network/follow] DELETE failed:", err);
    return json(503, { error: "unfollow unavailable" });
  }
}
