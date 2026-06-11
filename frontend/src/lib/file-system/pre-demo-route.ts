// Remembers the route a user was on when they jumped INTO the demo from inside
// the app, so leaving the demo returns them to that exact page instead of the
// home screen. Ephemeral (sessionStorage, this tab only). A public visitor who
// enters the demo from the welcome page never sets it, so leave falls back to
// "/".
//
// No emojis, no em-dashes, no mid-sentence colons.

const KEY = "researchos:pre-demo-route";

export function storePreDemoRoute(route: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, route);
  } catch {
    /* sessionStorage unavailable */
  }
}

/**
 * Read and clear the stored route. Returns null when none is stored, or when
 * the stored value is not a same-origin relative path (open-redirect guard).
 */
export function consumePreDemoRoute(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const r = window.sessionStorage.getItem(KEY);
    if (r) window.sessionStorage.removeItem(KEY);
    // Only honor a relative in-app path (must start with a single "/").
    return r && r.startsWith("/") && !r.startsWith("//") ? r : null;
  } catch {
    return null;
  }
}

/**
 * The in-app path a `/demo/<slug>` entry should redirect to once the demo
 * fixture is installed, preserving the query string and hash so a parameterized
 * deep link survives the demo redirect. A deep link like
 * `/demo/datahub?doc=5` resolves to `/datahub?doc=5`, so the target page can
 * read its param. The bare `/demo` entry returns "" (the caller renders Home in
 * place rather than redirecting).
 *
 * Pure: the caller passes pathname / search / hash (usePathname drops the
 * query, so the live window.location values are passed in at redirect time).
 */
export function demoRedirectTarget(
  pathname: string,
  search = "",
  hash = "",
): string {
  if (!pathname || pathname === "/demo") return "";
  const base = pathname.replace(/^\/demo/, "");
  if (base === "" || base === "/") return "";
  return `${base}${search}${hash}`;
}
