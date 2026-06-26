
export interface NavItem {
  href: string;
  label: string;
  /**
   * When true the nav item opens in a new browser tab rather than navigating
   * the app shell. Use for public marketing pages that live at the same origin
   * but outside the authenticated app chrome (e.g. /library).
   */
  newTab?: boolean;
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
  // /library (the open scientific-asset / icon library that feeds the Figure
  // composer). A shared resource, not a per-user workspace, so it is NOT in the
  // default inline set (DEFAULT_INLINE_HREFS) — it lands in the More overflow by
  // default. Gated visible in AppShell on ASSET_LIBRARY_ENABLED, like Figures.
  // newTab: true — /library is the public marketing landing (MarketingNav +
  // MarketingBackdrop); navigating to it in the same tab replaces the app
  // shell with the marketing chrome and leaves no way back. Open it in a new
  // tab so the user's app context is preserved.
  { href: "/library", label: "Icon Library", newTab: true },
  // /network is NO LONGER a customizable tab (Grant 2026-06-20). The researcher
  // network is a distinct destination, not a per-user workspace tool, so it now
  // lives as a permanent, non-draggable nav control (NetworkNavButton) that opens
  // the public .com network. The /network route itself still exists (gated by
  // SOCIAL_LAYER_ENABLED) and stays in the wiki-coverage EXCLUDED_PREFIXES.
  { href: "/inventory", label: "Inventory" },
  { href: "/purchases", label: "Purchases" },
  { href: "/calendar", label: "Calendar" },
  // Search is intentionally NOT a top-nav tab (nav audit, 2026-06-07). It lives
  // in the Cmd-K BeakerSearch palette (a pill on every page), which searches all
  // seven object kinds inline. The old standalone /search page (task-only +
  // multi-select export) was retired (UX clawback, 2026-06-26): its export moved
  // to the Workbench Experiments surface, and /search now redirects to
  // /workbench for any stray bookmark.
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
