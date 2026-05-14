/**
 * Static map of in-app feature route → wiki page that documents it.
 * Used by `<OpenDocsButton>` so a visitor exploring `/methods` inside the
 * `/demo` route gets a "Read the docs" affordance that lands them on
 * `/wiki/features/methods`.
 *
 * Returns `null` for routes with no wiki counterpart so the button
 * silently disappears rather than 404'ing. The `nav.ts` file has a
 * similar map (`APP_ROUTE_TO_WIKI`) used by the in-app `?` help icon,
 * which falls back to the wiki landing page; this map is intentionally
 * separate so the demo button can render nothing on unmapped routes.
 */

export const ROUTE_TO_WIKI: Record<string, string> = {
  "/": "/wiki/features/home",
  "/gantt": "/wiki/features/gantt",
  "/experiments": "/wiki/features/experiments",
  "/methods": "/wiki/features/methods",
  "/pcr": "/wiki/features/pcr",
  "/purchases": "/wiki/features/purchases",
  "/results": "/wiki/features/results",
  "/calendar": "/wiki/features/calendar",
  "/lab": "/wiki/features/lab-mode",
  "/search": "/wiki/features/search",
  "/links": "/wiki/features/links",
  "/settings": "/wiki/features/settings",
};

export function getWikiForRoute(pathname: string): string | null {
  return ROUTE_TO_WIKI[pathname] ?? null;
}
