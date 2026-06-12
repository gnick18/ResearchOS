import { NavItem, HOME_HREF } from "./nav";

/**
 * The saved inline-vs-More split. Both arrays are ordered hrefs. This is the
 * shape stored on `UserSettings.navLayout` and mirrored into the Zustand store.
 */
export interface NavLayout {
  inline: string[];
  more: string[];
}

/**
 * The resolved split, as NavItem objects, ready to render. `inline` sits in the
 * slim bar, `more` lives behind the More overflow menu.
 */
export interface ResolvedNavLayout {
  inline: NavItem[];
  more: NavItem[];
}

/**
 * The default inline set, by href. Anything visible but not listed here lands
 * in More. The Lab-Overview remap reuses HOME_HREF's slot, so we key the home
 * entry off "is it the first/home-like item" at reconcile time, not off this
 * literal list. Order here is the default bar order.
 */
export const DEFAULT_INLINE_HREFS: string[] = [
  HOME_HREF,
  "/lab-overview", // the lab-head remap of Home keeps Home's inline slot
  "/workbench",
  "/gantt",
  "/methods",
  "/datahub",
  "/calendar",
];

/**
 * Reconcile a saved layout (or none) against the FINAL rendered nav list.
 *
 * Rules:
 *  - Start from the saved split, intersected with the current navItems hrefs.
 *  - A current navItem in NEITHER saved list (newly visible tab) appends to More.
 *  - A saved href no longer present is dropped.
 *  - The Home / Lab-Overview entry is forced first in inline.
 *  - De-dupe across both lists (an href appears at most once, inline wins).
 *  - With no saved layout, apply the default split (DEFAULT_INLINE_HREFS), still
 *    reconciled against whatever is actually visible.
 *
 * This is presentation-agnostic. Responsive auto-overflow (spilling inline tabs
 * into More when the window is narrow) is layered on TOP of this in the
 * component and never mutates the saved layout.
 */
export function resolveNavLayout(
  navItems: NavItem[],
  saved: NavLayout | null | undefined,
): ResolvedNavLayout {
  const byHref = new Map(navItems.map((item) => [item.href, item]));
  // The home-like entry: "/" for members, or its lab-head remap "/lab-overview".
  const homeItem =
    byHref.get(HOME_HREF) ?? byHref.get("/lab-overview") ?? null;

  const inlineHrefs: string[] = [];
  const moreHrefs: string[] = [];
  const placed = new Set<string>();

  const place = (href: string, target: string[]): void => {
    if (placed.has(href)) return;
    if (!byHref.has(href)) return;
    placed.add(href);
    target.push(href);
  };

  if (saved && Array.isArray(saved.inline) && Array.isArray(saved.more)) {
    // Honor the saved order, intersected with what is currently visible.
    for (const href of saved.inline) place(href, inlineHrefs);
    for (const href of saved.more) place(href, moreHrefs);
    // Any currently-visible tab in neither saved list appends to More.
    for (const item of navItems) place(item.href, moreHrefs);
  } else {
    // No saved layout: default split, reconciled against what is visible.
    for (const href of DEFAULT_INLINE_HREFS) place(href, inlineHrefs);
    // Everything else visible (and not already inline) lands in More, in
    // nav order.
    for (const item of navItems) place(item.href, moreHrefs);
  }

  // Force the home-like entry first in inline (and never leave it in More).
  if (homeItem) {
    const h = homeItem.href;
    const fromInline = inlineHrefs.indexOf(h);
    if (fromInline !== -1) inlineHrefs.splice(fromInline, 1);
    const fromMore = moreHrefs.indexOf(h);
    if (fromMore !== -1) moreHrefs.splice(fromMore, 1);
    inlineHrefs.unshift(h);
  }

  return {
    inline: inlineHrefs.map((href) => byHref.get(href)!),
    more: moreHrefs.map((href) => byHref.get(href)!),
  };
}
