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
  { href: "/purchases", label: "Purchases" },
  { href: "/results", label: "Results" },
  { href: "/calendar", label: "Calendar" },
  { href: "/search", label: "Search" },
  { href: "/links", label: "Lab Links" },
];

export const HOME_HREF = "/";
export const ALL_TAB_HREFS = NAV_ITEMS.map((item) => item.href);

export function isValidTabHref(href: string): boolean {
  return ALL_TAB_HREFS.includes(href);
}

export function getNavItem(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}
