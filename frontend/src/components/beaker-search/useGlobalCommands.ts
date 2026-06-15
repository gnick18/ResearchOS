"use client";

// sequence editor master. BeakerSearch step 2a, the ALWAYS-PRESENT global layer.
//
// This hook builds the global command set the provider merges BENEATH whatever
// page source is active (master proposal, "the page's own context leads, the
// global reach lives below"). It lives under the Next router + theme, so its
// run handlers can push routes and flip the theme directly.
//
// Two groups, both appended at the end of COMMAND_GROUP_ORDER so they trail a
// page's own intent groups:
//   - "Go to" : one row per top-level NAV_ITEMS route (cross-page navigation).
//   - "App"   : app-level commands that are PURE and SAFE only (no modals, no
//               destructive actions). Toggle dark mode, open Settings.
//
// We deliberately list EVERY NAV_ITEMS route here rather than mirroring the
// AppShell's per-account visibility filter (deriveVisibleTabs + feature picks +
// account type). That filter is component-state-bound and non-trivial to reuse
// from a hook; for this v1 the worst case is a "Go to <hidden tab>" row that
// lands on a route the user has hidden but which still renders. That is an
// acceptable v1 edge (a hidden tab is hidden from the strip, not access-gated).
// A later step can thread the visible-tab set through the global source.
//
// FUTURE App commands that are intentionally NOT here because they open a flow
// or are destructive (each needs its own surface, not a bare router push):
// "New project", "Switch user", "Sign out", and any delete. Add them only with
// the flow they trigger, never as a naked command.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { EditorCommand } from "@/components/sequences/editor-commands";
import type { IconName } from "@/components/icons";
import { NAV_ITEMS } from "@/lib/nav";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import { useTheme } from "@/lib/theme/use-theme";

/** A sensible existing Icon for each top-level route. Falls back to "more"
 *  for any route not mapped (a new NAV_ITEMS entry still gets a row). The
 *  registry has no calendar / cart / home glyphs, so the nearest reads stand in
 *  (history for Calendar, download for Purchases, folder for Home, vial for
 *  Inventory, matching the global object index). Every value MUST be a real
 *  registry key; an unregistered name (e.g. the old "concept") crashes <Icon>. */
export const NAV_ICON_BY_HREF: Record<string, IconName> = {
  "/": "folder",
  "/workbench": "assemble",
  "/gantt": "list",
  "/methods": "book",
  "/sequences": "sequence",
  "/chemistry": "vial",
  "/datahub": "chart",
  // /phylo (Phylogenetics: Tree Builder + Tree Studio) uses the branching-node
  // "tree" glyph, which literally depicts a phylogenetic tree. Distinct from
  // "labTree" (the lab-mentorship hierarchy), so no meaning collision.
  "/phylo": "tree",
  // /figures (the universal figure composer) uses the dedicated "figure" glyph
  // (a framed plot panel + caption), distinct from "chart" (Data Hub) and
  // "results" (analysis output).
  "/figures": "figure",
  // /library (the open icon/asset library) reuses the "library" glyph (a
  // browsable catalog of reusable items) — the same meaning the method template
  // library uses it for, so no glyph-per-meaning collision.
  "/library": "library",
  "/purchases": "download",
  "/calendar": "history",
  "/inventory": "vial",
  // Supplies v2 chunk 7: the unified /supplies page collapses Inventory +
  // Purchases under the flag. Mapped to "box" (the same glyph the Supplies hub
  // header + nav item use) so the "Go to Supplies" row reads meaningfully.
  "/supplies": "box",
  "/search": "search",
  "/links": "share",
};

/** Title-case a nav label for the "Go to X" row, leaving already-cased labels
 *  (GANTT) alone past their first letter. We only need the first letter upper
 *  for the lower-case ones; the source labels are already display-cased, so
 *  this is effectively a pass-through that guards a stray lower-case entry. */
function titleCaseLabel(label: string): string {
  if (label.length === 0) return label;
  return label[0].toUpperCase() + label.slice(1);
}

/** Build the global "Go to" + "App" commands. Memoized on the router + theme
 *  setter so the source object the provider hands to the registry is stable
 *  across renders (the registry effect is keyed on the source value). */
export function useGlobalCommands(): EditorCommand[] {
  const router = useRouter();
  const pathname = usePathname();
  const { resolved, setTheme } = useTheme();

  return useMemo<EditorCommand[]>(() => {
    const goTo: EditorCommand[] = NAV_ITEMS.filter((item) => {
      // Inventory never gets its own "Go to" row: it is hidden behind the flag
      // when off (the route shows a "not enabled" state), and collapsed into the
      // unified "Go to Supplies" row injected below when on (Supplies v2 chunk
      // 7). Either way "Go to Inventory" never surfaces a route the visible nav
      // suppresses.
      if (item.href === "/inventory") return false;
      // Supplies v2 chunk 7: under the flag, /purchases also collapses into the
      // unified "Go to Supplies" row (it only redirects into /supplies now).
      // With the flag off this branch is skipped and Purchases keeps its own row.
      if (INVENTORY_ENABLED && item.href === "/purchases") return false;
      // Drop the route you are already on. "Go to Workbench" while on
      // /workbench is a no-op row, so suppress it rather than show a dead entry.
      if (item.href === pathname) return false;
      return true;
    }).map((item) => ({
      id: `goto-${item.href}`,
      label: `Go to ${titleCaseLabel(item.label)}`,
      group: "Go to",
      iconName: NAV_ICON_BY_HREF[item.href] ?? "more",
      // The bare page name widens the fuzzy match, so typing "workbench" finds
      // "Go to Workbench" without the "go to" prefix.
      keywords: item.label,
      run: () => router.push(item.href),
    }));

    // Supplies v2 chunk 7: inject the unified "Go to Supplies" row under the
    // flag, in place of the suppressed /inventory + /purchases rows. /supplies
    // is not a NAV_ITEMS entry (it is synthesized in the AppShell nav too), so
    // it is added here rather than read from the canonical list. Suppressed
    // when already on /supplies, mirroring the same-route rule above.
    if (INVENTORY_ENABLED && pathname !== "/supplies") {
      goTo.push({
        id: "goto-/supplies",
        label: "Go to Supplies",
        group: "Go to",
        iconName: NAV_ICON_BY_HREF["/supplies"] ?? "more",
        keywords: "Supplies inventory purchases",
        run: () => router.push("/supplies"),
      });
    }

    // The icon-library sub-routes are not NAV_ITEMS, so they don't get an
    // auto-generated "Go to" row. Add them explicitly so the contribution +
    // peer-review surfaces are reachable from BeakerSearch (typing "contribute"
    // or "review icon"), not buried behind the /library landing alone.
    if (pathname !== "/library/contribute") {
      goTo.push({
        id: "goto-/library/contribute",
        label: "Contribute an icon",
        group: "Go to",
        iconName: "plus",
        keywords: "icon library contribute submit add upload asset",
        run: () => router.push("/library/contribute"),
      });
    }
    if (pathname !== "/library/review") {
      goTo.push({
        id: "goto-/library/review",
        label: "Review icon submissions",
        group: "Go to",
        iconName: "check",
        keywords: "icon library review verify approve flag peer community",
        run: () => router.push("/library/review"),
      });
    }

    const app: EditorCommand[] = [
      {
        id: "app-toggle-theme",
        label: "Toggle dark mode",
        group: "App",
        iconName: "eye",
        keywords: "theme light dark appearance",
        run: () => setTheme(resolved === "dark" ? "light" : "dark"),
      },
      {
        id: "app-open-settings",
        label: "Open Settings",
        group: "App",
        iconName: "more",
        keywords: "settings preferences options account",
        run: () => router.push("/settings"),
      },
      // Open Sequences / Methods and the rest of the routes are already covered
      // by the "Go to" group above, so they are not repeated here.
    ];

    return [...goTo, ...app];
  }, [router, pathname, resolved, setTheme]);
}
