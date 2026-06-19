import { NextRequest, NextResponse } from "next/server";

import { isLabSitesComOriginEnabled, isLabSitesEnabled } from "@/lib/social/config";
import { resolveLabHostRequest, resolveAppOriginLabRedirect } from "@/lib/social/lab-byo";

/**
 * Maintenance-mode gate (Next.js "proxy" file convention, formerly middleware)
 * plus the lab-site public-origin router.
 *
 * Lab origin: when the research-os.com cutover is enabled, a request whose Host is
 * a per-lab subdomain `<slug>.research-os.com` is routed to the lab's PUBLIC
 * surface only (native pages, the BYO bundle under /_site, and the one public
 * dataset-stream API), and every other route (auth, the app, all other APIs) is
 * 404ed there, so no app cookie is ever set on the cookie-isolated origin. The
 * decision is the pure resolveLabHostRequest() so it is unit tested. On the app
 * origin this is a complete no-op.
 *
 * Maintenance: when MAINTENANCE_MODE is "true", every page request is rewritten to
 * the /maintenance holding page so a half-finished app never reaches users during
 * heavy backend migration work. A bypass cookie (set by visiting
 * /?unlock=<MAINTENANCE_BYPASS_SECRET>) lets the operator through to test the
 * real site. With the flag unset or not "true", this is a no-op, so committing
 * it does not change normal behavior until the flag is flipped in the deploy
 * env.
 *
 * Scope: page navigations PLUS /api (the matcher now includes /api so the lab
 * origin can gate API routes). On the app origin the /api short-circuit below
 * preserves the prior zero-middleware-on-API behavior exactly. The matcher still
 * excludes Next internals, /_vercel, and static assets.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

const UNLOCK_COOKIE = "ros_maint_unlock";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Lab public-origin routing. Fires ONLY for a real lab subdomain of the public
  // lab domain when the cutover flag is on, so it is a no-op on the app origin and
  // while the flag is off. Runs before everything else so the lab origin never
  // falls through to the dev gate or the maintenance rewrite.
  const comOriginEnabled = isLabSitesEnabled() && isLabSitesComOriginEnabled();
  const labAction = resolveLabHostRequest({
    host: req.headers.get("host"),
    pathname,
    enabled: comOriginEnabled,
  });
  if (labAction.kind !== "passthrough") {
    switch (labAction.kind) {
      case "allow-api":
        return NextResponse.next();
      case "block":
        return new NextResponse(null, { status: 404 });
      case "rewrite-byo": {
        const url = req.nextUrl.clone();
        url.pathname = "/api/social/lab-site/byo/serve";
        url.search = "";
        url.searchParams.set("slug", labAction.slug);
        if (labAction.path) url.searchParams.set("path", labAction.path);
        return NextResponse.rewrite(url);
      }
      case "rewrite-native": {
        // Host carries the slug; map <slug>.<domain>/<path> to the internal
        // /<slug>/<path> the existing [labSlug] route serves. Rewrite (not
        // redirect) so the public URL stays the subdomain. Query is preserved.
        const url = req.nextUrl.clone();
        url.pathname = `/${labAction.slug}${labAction.path === "/" ? "" : labAction.path}`;
        return NextResponse.rewrite(url);
      }
    }
  }

  // App origin from here. The matcher now also runs on /api so the lab origin can
  // gate it above; on the app origin, preserve the prior behavior where API routes
  // do NO middleware work (never dev-gated, never maintenance-rewritten).
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // App-origin to lab-subdomain 308 (research-os.com cutover, citation continuity).
  // An old research-os.app/<slug> link gets a TRUE 308 to <slug>.research-os.com.
  // This lives here, not the [labSlug] page, because a Server Component redirect to
  // an external URL renders a 200 client-side fallback (the gate then shows the
  // welcome page), never a real 3xx. resolveAppOriginLabRedirect returns null unless
  // the cutover is on, the host is the app origin, and the first path segment is a
  // claimable lab slug (slug-shaped + NOT a RESERVED app route), so real app routes
  // are never redirected. Query is preserved.
  const labRedirect = resolveAppOriginLabRedirect({
    host: req.headers.get("host"),
    pathname,
    enabled: comOriginEnabled,
  });
  if (labRedirect) {
    const target = new URL(labRedirect);
    target.search = req.nextUrl.search;
    return NextResponse.redirect(target, 308);
  }

  // Hard-gate the internal /dev/* tree in any DEPLOYED build. NODE_ENV is
  // "production" for every Vercel deployment (preview AND prod); only a local
  // `next dev` is "development". This runs in middleware, BEFORE routing, on
  // purpose: the app/dev/layout.tsx notFound() gate does NOT 404 these routes in
  // a deployed build (verified live), so the internal scratch surfaces (the
  // pricing cost model, design probes, demo pages) stayed reachable. Middleware
  // cannot be bypassed by routing, so a 404 here closes the whole tree.
  if (
    process.env.NODE_ENV === "production" &&
    (pathname === "/dev" || pathname.startsWith("/dev/"))
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // Off unless deliberately enabled, so this is a no-op in normal operation.
  if (process.env.MAINTENANCE_MODE !== "true") {
    return NextResponse.next();
  }

  const { searchParams } = req.nextUrl;
  const secret = process.env.MAINTENANCE_BYPASS_SECRET;

  // Let the holding page itself through (avoids a rewrite loop).
  if (pathname === "/maintenance") {
    return NextResponse.next();
  }

  // Unlock flow: ?unlock=<secret> sets the bypass cookie, then redirects to a
  // clean URL so the secret does not linger in the address bar.
  const unlock = searchParams.get("unlock");
  if (secret && unlock !== null && unlock === secret) {
    const cleanUrl = req.nextUrl.clone();
    cleanUrl.searchParams.delete("unlock");
    const res = NextResponse.redirect(cleanUrl);
    res.cookies.set(UNLOCK_COOKIE, secret, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return res;
  }

  // A holder of the bypass cookie sees the real site.
  if (secret && req.cookies.get(UNLOCK_COOKIE)?.value === secret) {
    return NextResponse.next();
  }

  // Everyone else gets the holding page. Rewrite keeps their URL intact.
  const target = req.nextUrl.clone();
  target.pathname = "/maintenance";
  return NextResponse.rewrite(target);
}

export const config = {
  // Run on page navigations AND /api. The first entry is page navigations
  // (excluding Next internals, the Vercel insight endpoints, /api, and common
  // static file extensions). The second entry adds /api so the lab-origin router
  // can gate API routes on the cookie-isolated lab subdomain; on the app origin
  // the /api short-circuit in proxy() preserves the prior no-middleware behavior.
  matcher: [
    "/((?!api|_next/static|_next/image|_vercel|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|woff|woff2|ttf|otf)$).*)",
    "/api/:path*",
  ],
};
