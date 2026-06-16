// Lab companion-site hosted-asset PUBLIC READ endpoint (lab-domains Phase 4a,
// social lane).
//
//   GET /api/social/lab-site/asset/read?id=<assetId>
//     -> the Parquet bytes (application/vnd.apache.parquet), or 404.
//
// This is the ONLY public, login-free endpoint of Phase 4a. The public dataset
// viewer (PublicDatasetEmbed) fetches the Parquet bytes from here, and the server
// streams them from R2. Routing the read through a same-origin endpoint (rather
// than handing the browser a presigned R2 URL) means: no presigned URL ever leaks
// to the public, the R2 origin is a server-only secret, and the browser fetch is
// same-origin so the CSP connect-src needs no R2 host added for the read path.
//
// GATING:
//   - flag        isLabSitesEnabled() false => 404, so the whole feature is inert
//                 with the flag off (byte-identical to a missing route).
//   - id shape    isValidAssetId rejects a hand-crafted key BEFORE touching R2, so
//                 a caller cannot probe arbitrary object keys.
//   - object gone readAssetBytes returns null for a missing / GC'd / never-uploaded
//                 object => 404, and the viewer falls back to the baked snapshot.
//
// No auth: a published companion site is a PUBLIC surface (like /institution/[slug]
// or a published page), and the bytes are the lab's own data the author chose to
// publish. The asset is reachable only by its opaque, hash-derived id, which only
// appears in a published page's manifest.
//
// Reads env: LAB_SITES_ENABLED, R2_*.

import { isAssetStoreConfigured, readAssetBytes } from "@/lib/social/lab-site-asset-store";
import { isValidAssetId } from "@/lib/social/lab-site-hosted";
import { isLabSitesEnabled } from "@/lib/social/config";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isLabSitesEnabled()) {
    return new Response("not found", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!isValidAssetId(id)) {
    return new Response("not found", { status: 404 });
  }

  if (!isAssetStoreConfigured()) {
    // No R2 configured: the viewer degrades to the baked snapshot on a 404/503.
    return new Response("hosting unavailable", { status: 503 });
  }

  const bytes = await readAssetBytes(id);
  if (!bytes) {
    return new Response("not found", { status: 404 });
  }

  // Copy into a fresh ArrayBuffer so the Response body is a clean, detached
  // BodyInit (the R2 byte array may be a view into a pooled buffer).
  const out = bytes.slice();
  return new Response(out, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apache.parquet",
      "content-length": String(out.byteLength),
      // The bytes are immutable per assetId (a re-publish overwrites the same key
      // with a new body, and the manifest is versioned), so allow short caching.
      "cache-control": "public, max-age=300",
    },
  });
}
