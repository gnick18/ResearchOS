// returnDestinationLabel maps a raw `from=` route param (e.g. "/", "/datahub")
// to a friendly human destination name for the account folder-connect banner.
//
// Guarantee: this NEVER returns a bare route or path. Unknown, empty, or "/"
// routes fall back to "ResearchOS". Keep the map small and readable.

const ROUTE_LABELS: Record<string, string> = {
  "/": "ResearchOS",
  "/workbench": "Your workbench",
  "/datahub": "Data Hub",
  "/methods": "Methods",
  "/gantt": "Your timeline",
  "/calendar": "Your calendar",
  "/figures": "Figures",
  "/network": "The network",
  "/settings": "Settings",
};

export function returnDestinationLabel(route: string | null): string {
  if (!route) return "ResearchOS";

  // Strip any query string / hash, then trailing slashes.
  let path = route.split("?")[0].split("#")[0];
  path = path.replace(/\/+$/, "");
  if (path === "") path = "/";

  return ROUTE_LABELS[path] ?? "ResearchOS";
}
