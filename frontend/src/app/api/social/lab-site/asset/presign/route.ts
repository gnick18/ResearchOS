// Lab companion-site hosted-asset PRESIGN endpoint (lab-domains Phase 4a, social
// lane).
//
//   POST /api/social/lab-site/asset/presign
//     Body: { path, href }   (path = the page path, "" = home; href = the dataset
//                              embed link href the asset backs)
//     -> { assetId, uploadUrl, contentType }
//
// The author's browser calls this to obtain a short-lived presigned R2 PUT URL,
// then uploads the exported Parquet bytes DIRECTLY to R2 (the bytes never transit
// this server). The assetId is derived deterministically from (lab, path, href)
// so a re-publish overwrites the same R2 object and re-registers the same billing
// row (no per-publish leak).
//
// AUTHZ (fail closed, IDENTICAL to the page publish route's gate):
//   1. flag        isLabSitesEnabled() true, else 404.
//   2. signed in   caller owner key from the SESSION, never the body. No key => 401.
//   3. owns lab    the asset is keyed to the caller's OWN lab (the assetId folds in
//                  the caller's owner key), so authorizeWrite enforces
//                  targetOwnerKey === callerOwnerKey by construction.
//   4. entitled    isLabPublishEntitled(callerOwnerKey) === true, else 403.
//   + a caller with no site yet => 409 "no site".
//   + R2 not configured => 503 "hosting unavailable" (no silent stub).
//
// Reads env: LAB_SITES_ENABLED, R2_* , DATABASE_URL, AUTH_* + pepper.

import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import {
  isAssetStoreConfigured,
  presignAssetPut,
  ASSET_PUT_CONTENT_TYPE,
} from "@/lib/social/lab-site-asset-store";
import { getSiteByOwner } from "@/lib/social/lab-site-db";
import { hostedAssetId } from "@/lib/social/lab-site-hosted";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";

export const runtime = "nodejs";

interface PresignBody {
  path: string;
  href: string;
}

/** Validate the presign body: a string path (may be "") and a non-empty href. */
function parsePresignBody(body: unknown): PresignBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.path !== "string") return null;
  if (typeof b.href !== "string" || b.href.length === 0) return null;
  return { path: b.path, href: b.href };
}

export async function POST(request: Request): Promise<Response> {
  // 1. flag
  if (!isLabSitesEnabled()) return json(404, { error: "not found" });

  // 2-4. session -> ownership -> entitlement (same fail-closed order as the page
  // route; an asset always targets the caller's own lab, so target === caller).
  const callerOwnerKey = await resolveCallerOwnerKey();
  const entitled = callerOwnerKey
    ? await isLabPublishEntitled(callerOwnerKey)
    : false;
  const verdict = authorizeWrite({
    callerOwnerKey,
    targetOwnerKey: callerOwnerKey,
    entitled,
  });
  if (verdict.kind === "deny") {
    return json(verdict.status, { error: verdict.error });
  }
  const ownerKey = callerOwnerKey as string;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parsePresignBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  // The lab must have a site before it can host assets.
  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  if (!isAssetStoreConfigured()) {
    return json(503, { error: "hosting unavailable" });
  }

  const assetId = hostedAssetId(ownerKey, parsed.path, parsed.href);
  const uploadUrl = await presignAssetPut(assetId);
  if (!uploadUrl) return json(503, { error: "hosting unavailable" });

  return json(200, {
    assetId,
    uploadUrl,
    contentType: ASSET_PUT_CONTENT_TYPE,
  });
}
