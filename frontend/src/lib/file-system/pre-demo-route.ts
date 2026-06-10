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
