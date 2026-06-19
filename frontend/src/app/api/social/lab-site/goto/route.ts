import { NextRequest, NextResponse } from "next/server";

import { isLabSitesComOriginEnabled } from "@/lib/social/config";
import { labSiteOrigin } from "@/lib/social/lab-byo";
import { normalizeSlug } from "@/lib/social/slug-registry";

// Cross-origin redirector for the lab-site research-os.com cutover.
//
// A Server Component page (the [labSlug] route) cannot issue a true cross-origin
// HTTP redirect: redirect()/permanentRedirect() to an EXTERNAL absolute URL during
// the streamed RSC render falls back to a client-side redirect and returns 200, not
// a 308. So the page (which has already DB-gated the slug to a real published lab
// page) redirects SAME-ORIGIN here, and this route handler issues the real 308 to
// the per-lab subdomain. Route handlers can return cross-origin redirects reliably.
//
// The page is the access gate (it only redirects for a real lab); this handler is
// just the redirect mechanism, so it does no DB lookup. It still validates the slug
// charset defensively, and labSiteOrigin only ever builds a subdomain of our own
// public lab domain, so this can never be an open redirect to an arbitrary host.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const runtime = "nodejs";

export function GET(req: NextRequest): NextResponse {
  // Only meaningful while the cutover is on; otherwise behave like a missing route.
  if (!isLabSitesComOriginEnabled()) {
    return new NextResponse(null, { status: 404 });
  }
  const slug = normalizeSlug(req.nextUrl.searchParams.get("slug") ?? "");
  // Defensive: only a clean slug label (the same charset labSlugFromHost accepts),
  // so the redirect target is always exactly <slug>.research-os.com.
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    return new NextResponse(null, { status: 404 });
  }
  const rawPath = req.nextUrl.searchParams.get("path") ?? "";
  const tail = rawPath ? `/${rawPath.replace(/^\/+/, "")}` : "";
  return NextResponse.redirect(`${labSiteOrigin(slug)}${tail}`, 308);
}
