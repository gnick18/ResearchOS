import { NextRequest, NextResponse } from "next/server";

/**
 * Maintenance-mode gate.
 *
 * When MAINTENANCE_MODE is "true", every page request is rewritten to the
 * /maintenance holding page so a half-finished app never reaches users during
 * heavy backend migration work. A bypass cookie (set by visiting
 * /?unlock=<MAINTENANCE_BYPASS_SECRET>) lets the operator through to test the
 * real site. With the flag unset or not "true", this middleware is a no-op, so
 * committing it does not change normal behavior until the flag is flipped in
 * the deployment env.
 *
 * Scope: page navigations only. The matcher excludes Next internals, static
 * assets, /_vercel, and /api (API routes have their own env gating, and the UI
 * that would call them is blocked anyway). The data is not sensitive; this is a
 * soft "the site is down" gate, not an auth boundary.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

const UNLOCK_COOKIE = "ros_maint_unlock";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function middleware(req: NextRequest): NextResponse {
  // Off unless deliberately enabled, so this is a no-op in normal operation.
  if (process.env.MAINTENANCE_MODE !== "true") {
    return NextResponse.next();
  }

  const { pathname, searchParams } = req.nextUrl;
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
  // Run on page navigations only. Exclude Next internals, the Vercel insight
  // endpoints, API routes, and common static file extensions so the holding
  // page and its assets always load.
  matcher: [
    "/((?!api|_next/static|_next/image|_vercel|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|woff|woff2|ttf|otf)$).*)",
  ],
};
