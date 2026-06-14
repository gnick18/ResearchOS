export interface NavItem {
  href: string;
  label: string;
}

// Canonical list of in-app navigation tabs. The user can hide any of these
// except Home via Settings → Tabs (Home is always shown so the user has a
// guaranteed safe landing target). Settings itself is intentionally NOT in
// this list — it's reached via the gear icon in AppShell so it can never be
// hidden.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/workbench", label: "Workbench" },
  { href: "/gantt", label: "GANTT" },
  { href: "/methods", label: "Methods" },
  { href: "/sequences", label: "Sequences" },
  { href: "/chemistry", label: "Chemistry" },
  { href: "/datahub", label: "Data Hub" },
  { href: "/phylo", label: "Phylogenetics" },
  { href: "/figures", label: "Figures" },
  { href: "/inventory", label: "Inventory" },
  { href: "/purchases", label: "Purchases" },
  { href: "/calendar", label: "Calendar" },
  // Search is intentionally NOT a top-nav tab (nav audit, 2026-06-07). It lives
  // in the Cmd-K BeakerSearch palette (a pill on every page), which hands off to
  // /search?keywords= for advanced filtering + export. The /search route still
  // works; it is just not duplicated as a nav button.
  // Copy-alignment manager 2026-05-26: tab labeled "Links" for all
  // account types. The earlier "Lab Links" carve-out for lab accounts
  // (AppShell.tsx, /links/page.tsx, SetupWrapupStep.tsx) drifted across
  // pre-tour vs post-tour states and confused break-bots; master called
  // "Links" everywhere. Wiki copy that still uses "Lab Links" stays for
  // historical context but the rendered nav + page header read "Links".
  { href: "/links", label: "Links" },
];

export const HOME_HREF = "/";
export const ALL_TAB_HREFS = NAV_ITEMS.map((item) => item.href);

export function isValidTabHref(href: string): boolean {
  return ALL_TAB_HREFS.includes(href);
}

export function getNavItem(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}
