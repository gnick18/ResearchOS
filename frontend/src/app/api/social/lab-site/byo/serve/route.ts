// Lab BYO ("bring your own") static-site PUBLIC SERVE endpoint (lab-domains BYO
// Slice 1, social lane).
//
//   GET /api/social/lab-site/byo/serve
//     Resolution of the lab + the file path (first match wins):
//       - Host header `<labSlug>.research-os.com`   (production, once wildcard DNS
//         + the Vercel domain config exist; see the handoff GO-LIVE step), OR
//       - ?slug=<labSlug>                            (testable fallback without DNS)
//       and the file sub-path from ?path=<...> (default "" = the site index.html).
//     -> the matching file's bytes with its stored Content-Type, or 404.
//
// This is the route that `<labSlug>.research-os.com/<path>` maps to. research-os.com
// is the ASSETS domain: R2-backed, NO auth, NO app cookies, and a DIFFERENT
// registrable domain from the app's research-os.app, so the untrusted lab JS that
// loads from here is automatically cookie-isolated from the authed app. THIS ROUTE
// MUST NEVER set an app cookie or serve the authed app.
//
// SECURITY:
//   - X-Content-Type-Options: nosniff so the browser never re-interprets an
//     unexpected file as HTML/script.
//   - the served file path is resolved + zip-slip-sanitized (resolveByoServePath)
//     AND must appear in the lab's stored manifest, so a crafted ?path= can never
//     read outside the lab's own uploaded set.
//   - no Set-Cookie, no auth, no app shell. The bytes are the lab's own published
//     static site.
//
// GATING: isLabByoSitesEnabled() (lab-sites AND BYO sub-flag) false => 404, so the
// route is inert unless BOTH flags are on. A missing slug / lab / file => 404.
//
// Reads env: LAB_SITES_ENABLED, LAB_BYO_SITES, R2_*, DATABASE_URL.

import { readByoFile } from "@/lib/social/lab-site-asset-store";
import { getSiteBySlug } from "@/lib/social/lab-site-db";
import { getByoSiteByOwner } from "@/lib/social/lab-byo-db";
import {
  byoLabFragment,
  contentTypeForPath,
  labSlugFromHost,
  resolveByoServePath,
} from "@/lib/social/lab-byo";
import { isLabByoSitesEnabled } from "@/lib/social/config";
import { bumpLabSiteView } from "@/lib/social/lab-site-analytics";

export const runtime = "nodejs";

/** Safe response headers for an untrusted-static-file response. nosniff is the key
 *  one (never re-interpret bytes); cache is short because a re-upload replaces the
 *  same keys. Deliberately NO Set-Cookie and NO app headers. */
function serveHeaders(contentType: string, byteLength: number): HeadersInit {
  return {
    "content-type": contentType,
    "content-length": String(byteLength),
    "x-content-type-options": "nosniff",
    // A BYO site is a separate, sandboxed origin; deny framing of these bytes by
    // the app to avoid any UI-redress confusion.
    "x-frame-options": "DENY",
    "cache-control": "public, max-age=300",
  };
}

function notFound(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isLabByoSitesEnabled()) return notFound();

  const url = new URL(request.url);

  // Resolve the lab slug: Host subdomain first (production), ?slug= fallback (local
  // testing without the wildcard DNS).
  const hostSlug = labSlugFromHost(request.headers.get("host"));
  const slug = hostSlug ?? url.searchParams.get("slug");
  if (!slug) return notFound();

  // The file sub-path under the site. Default "" -> the index.
  const rawPath = url.searchParams.get("path") ?? "";
  const relPath = resolveByoServePath(rawPath);
  if (relPath === null) return notFound(); // traversal / malformed request path

  // Resolve the owning lab from the slug (the lab must have a claimed site).
  let labSite;
  try {
    labSite = await getSiteBySlug(slug);
  } catch {
    return notFound();
  }
  if (!labSite) return notFound();

  // Load the BYO manifest and confirm the resolved file is one the lab uploaded.
  // This is the second zip-slip / probe guard: even a sanitized path is only served
  // if it is in the manifest, so a caller cannot read arbitrary objects.
  let byo;
  try {
    byo = await getByoSiteByOwner(labSite.labOwnerKey);
  } catch {
    return notFound();
  }
  if (!byo) return notFound();
  const inManifest = byo.manifest.files.some((f) => f.path === relPath);
  if (!inManifest) return notFound();

  const fragment = byoLabFragment(labSite.labOwnerKey);
  const file = await readByoFile(fragment, relPath);
  if (!file) return notFound();

  // Prefer the stored Content-Type from R2; fall back to the per-extension type so
  // the response is never an unexpected default.
  const contentType = file.contentType ?? contentTypeForPath(relPath);

  // Part 3 analytics: count this BYO site view. Fire-and-forget -- a Neon
  // outage must never block or error the file serve response. The site_key
  // convention for BYO sites is "byo" (one counter for the whole uploaded site,
  // not per-file, matching the one-lump BYO billing model).
  void bumpLabSiteView(labSite.labOwnerKey, "byo");

  // Copy into a fresh detached buffer for a clean BodyInit.
  const out = file.bytes.slice();
  return new Response(out, {
    status: 200,
    headers: serveHeaders(contentType, out.byteLength),
  });
}
