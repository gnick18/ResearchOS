// Lab-site storage + analytics usage read route (lab-domains Part 2, social lane).
//
//   GET /api/social/lab-site/usage
//       ?siteOwnerKey=<key>   (optional, editor-grant path)
//       ?sinceDays=<n>        (optional, view window 1-365, default 30)
//
// Returns the PI's storage metering (total bytes + per-site, with dollar cost)
// and page-view analytics (total + per-site breakdown + daily sparkline series).
//
// AUTHZ mirrors /api/social/lab-site GET exactly:
//   1. flag        isLabSitesEnabled() must be true, else 404.
//   2. signed in   resolveCallerOwnerKey() -> 401 when absent.
//   3. entitled    isLabPublishEntitled(ownerKey) -> 403 when not entitled
//                  (owner path only).
//   4. editor path isSiteEditor(siteOwnerKey, "", callerOwnerKey) -> 403 when
//                  not granted.
//   5. store error -> 503.
//
// The dollar cost is always computed by hostedAssetMonthlyCost (the single
// canonical pricing helper, service-model.ts:274). No rate is recomputed here.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { getLabHostedBytes, getLabHostedBytesBySite } from "@/lib/collab/server/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import { isSiteEditor } from "@/lib/social/lab-site-editors-db";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { getLabSiteViews } from "@/lib/social/lab-site-analytics";
import { isLabSitesEnabled } from "@/lib/social/config";
import { hostedAssetMonthlyCost } from "@/lib/pricing/service-model";
import { humanizeSiteKey } from "@/lib/social/lab-site-usage-label";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isLabSitesEnabled()) return json(404, { error: "not found" });

  const callerOwnerKey = await resolveCallerOwnerKey();
  if (!callerOwnerKey) return json(401, { error: "unauthorized" });

  const { searchParams } = new URL(request.url);
  const siteOwnerKeyParam = searchParams.get("siteOwnerKey");

  // Parse sinceDays (optional, 1-365, default 30).
  const sinceDaysRaw = Number(searchParams.get("sinceDays") ?? "30");
  const sinceDays = Number.isFinite(sinceDaysRaw)
    ? Math.max(1, Math.min(365, Math.floor(sinceDaysRaw)))
    : 30;

  let ownerKey: string;

  if (siteOwnerKeyParam && siteOwnerKeyParam !== callerOwnerKey) {
    // Editor path: caller is not the site owner. Verify the grant server-side.
    let granted: boolean;
    try {
      granted = await isSiteEditor(siteOwnerKeyParam, "", callerOwnerKey);
    } catch {
      return json(503, { error: "store unavailable" });
    }
    if (!granted) return json(403, { error: "forbidden" });
    ownerKey = siteOwnerKeyParam;
  } else {
    // Owner path: read the caller's own lab usage. Entitlement check mirrors
    // the original GET handler in /api/social/lab-site/route.ts.
    const entitled = await isLabPublishEntitled(callerOwnerKey);
    const verdict = authorizeWrite({
      callerOwnerKey,
      targetOwnerKey: callerOwnerKey,
      entitled,
    });
    if (verdict.kind === "deny") {
      return json(verdict.status, { error: verdict.error });
    }
    ownerKey = callerOwnerKey;
  }

  // Fetch storage metering + page-view analytics in parallel. Any error from
  // either store returns 503.
  let totalBytes: number;
  let bySiteRaw: Awaited<ReturnType<typeof getLabHostedBytesBySite>>;
  let viewsRaw: Awaited<ReturnType<typeof getLabSiteViews>>;

  try {
    [totalBytes, bySiteRaw, viewsRaw] = await Promise.all([
      getLabHostedBytes(ownerKey),
      getLabHostedBytesBySite(ownerKey),
      getLabSiteViews(ownerKey, sinceDays),
    ]);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  const storageBySite = bySiteRaw.map((row) => ({
    siteKey: row.siteKey,
    label: humanizeSiteKey(row.siteKey),
    bytes: row.bytes,
    monthlyCostUsd: hostedAssetMonthlyCost(row.bytes),
  }));

  const viewsBySite = viewsRaw.bySite.map((row) => ({
    siteKey: row.siteKey,
    label: humanizeSiteKey(row.siteKey),
    views: row.views,
  }));

  return json(200, {
    storage: {
      totalBytes,
      totalMonthlyCostUsd: hostedAssetMonthlyCost(totalBytes),
      bySite: storageBySite,
    },
    views: {
      total: viewsRaw.total,
      bySite: viewsBySite,
      daily: viewsRaw.daily,
    },
  });
}
