// Lab companion-site hosted-asset REGISTER endpoint (lab-domains Phase 4a, social
// lane).
//
//   POST /api/social/lab-site/asset/register
//     Body: { path, href, bytes }
//     -> { assetId, bytes }
//
// After the author's browser uploads the Parquet to R2 (via the presigned PUT from
// the presign endpoint), it calls this to REGISTER the asset's byte size with the
// billing layer via setHostedAssetBytes(assetId, labOwnerKey, bytes). Billing then
// bills the lab for the hosted bytes (hostedAssetMonthlyCost); this lane only
// REPORTS the byte count, it never computes a price.
//
// The assetId is RE-DERIVED here from (caller owner key, path, href), never taken
// from the body, so a caller can only ever register an asset under its OWN lab and
// at its OWN deterministic key. bytes is clamped non-negative by the billing
// primitive.
//
// AUTHZ (fail closed, IDENTICAL to the presign + page publish routes):
//   1. flag isLabSitesEnabled() else 404; 2. signed in else 401; 3. owns lab
//   (assetId folds in the caller key) so target === caller; 4. entitled else 403;
//   + no site => 409.
//
// setHostedAssetBytes lives in @/lib/collab/server/db and is used READ-ONLY here
// (we call it, we do not modify it). Reads env: LAB_SITES_ENABLED, DATABASE_URL,
// AUTH_* + pepper.

import { setHostedAssetBytes } from "@/lib/collab/server/db";
import { isLabPublishEntitled } from "@/lib/billing/db";
import { json } from "@/lib/social/guard";
import { authorizeWrite } from "@/lib/social/lab-site-authoring";
import { getSiteByOwner } from "@/lib/social/lab-site-db";
import { hostedAssetId } from "@/lib/social/lab-site-hosted";
import { resolveCallerOwnerKey } from "@/lib/social/lab-site-session";
import { isLabSitesEnabled } from "@/lib/social/config";

export const runtime = "nodejs";

interface RegisterBody {
  path: string;
  href: string;
  bytes: number;
}

/** Validate the register body: a string path, a non-empty href, finite bytes. */
function parseRegisterBody(body: unknown): RegisterBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.path !== "string") return null;
  if (typeof b.href !== "string" || b.href.length === 0) return null;
  if (typeof b.bytes !== "number" || !Number.isFinite(b.bytes) || b.bytes < 0) {
    return null;
  }
  return { path: b.path, href: b.href, bytes: b.bytes };
}

export async function POST(request: Request): Promise<Response> {
  if (!isLabSitesEnabled()) return json(404, { error: "not found" });

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
  const parsed = parseRegisterBody(body);
  if (!parsed) return json(400, { error: "invalid request" });

  let site;
  try {
    site = await getSiteByOwner(ownerKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }
  if (!site) return json(409, { error: "no site" });

  // Re-derive the assetId from the proven owner key + the requested (path, href).
  // The body never carries the assetId, so a caller cannot register bytes against
  // another lab's asset.
  const assetId = hostedAssetId(ownerKey, parsed.path, parsed.href);

  // site_key is the page path the dataset embed lives on ("" => "home", else the
  // path). This tags the asset to the per-site storage breakdown for the PI view.
  const siteKey = parsed.path === "" ? "home" : parsed.path;

  try {
    await setHostedAssetBytes(assetId, ownerKey, parsed.bytes, siteKey);
  } catch {
    return json(503, { error: "store unavailable" });
  }

  return json(200, { assetId, bytes: Math.max(0, Math.round(parsed.bytes)) });
}
