// Operator console (admin IA redesign, 2026-06-19). BeakerSearch SOURCE for the
// operator shell, the Cmd-K "jump to any admin section" wiring.
//
// The redesigned OperatorShell renders its seven groups as top-level area TABS
// (Overview, Metrics, Accounts, Finances, Modeling, Comms), with only the active
// tab's sections in view. That makes a section two clicks away (pick the tab,
// then find the section). This source registers EVERY section as a palette nav
// item so an operator can press Cmd-K, type a section name ("ledger", "storage"),
// and jump straight to it. Running an item flips to the section's tab and scrolls
// the section into view via the page's goToSection handler.
//
// It lives inside OperatorShell, which only mounts for an operator (the /admin
// page server-gates on isOperator() before rendering the shell), so these entries
// never reach a non-operator. The shell is wrapped in BeakerSearchProvider only
// on the operator route, so the palette + the global Cmd-K listener exist there.
//
// The caller hands in the section catalog and a stable goToSection callback; the
// hook closes over them in a memoized source so the registration object is
// stable (the registry is keyed on the source value, see useBeakerSearchSource).
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useMemo } from "react";

import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import type {
  BeakerSearchSource,
  PaletteNavGroup,
} from "@/components/beaker-search/types";
import type { IconName } from "@/components/icons";

/** One jumpable admin section, the minimum the palette needs to list and run it. */
export interface OperatorSearchSection {
  id: string;
  /** The tab (group) the section lives under, e.g. "Finances". */
  group: string;
  /** Rail + palette label, e.g. "Ledger". */
  title: string;
  icon: IconName;
  /** Extra fuzzy-match text (the section's rows / synonyms). */
  keywords?: string;
  /** The Finances sub-group header, when the section sits under one. Folded into
   *  the palette detail so a search reads "Finances . Accounting". */
  subgroup?: string;
}

/** Register the operator console's "jump to a section" BeakerSearch source while
 *  the shell is mounted. goToSection MUST be stable (wrap it in useCallback). */
export function useOperatorBeakerSource(
  sections: OperatorSearchSection[],
  goToSection: (id: string) => void,
): void {
  const source = useMemo<BeakerSearchSource>(() => {
    // One group per tab, mirroring the shell's tab order, so the empty-query view
    // reads like the console's own table of contents. While typing, the palette
    // re-buckets the fuzzy hits under these same headings.
    const byGroup = new Map<string, OperatorSearchSection[]>();
    for (const s of sections) {
      const list = byGroup.get(s.group) ?? [];
      list.push(s);
      byGroup.set(s.group, list);
    }

    const navGroups: PaletteNavGroup[] = [];
    for (const [group, list] of byGroup) {
      navGroups.push({
        title: `Jump to ${group}`,
        items: list.map((s) => ({
          id: `op-jump-${s.id}`,
          label: s.title,
          detail: s.subgroup ? `${s.group} . ${s.subgroup}` : s.group,
          keywords: [s.group, s.subgroup, s.keywords]
            .filter(Boolean)
            .join(" "),
          iconName: s.icon,
          onRun: () => goToSection(s.id),
        })),
      });
    }

    return {
      id: "operator-console",
      // No page commands, this surface is pure navigation. The global "Go to"
      // commands still come from the provider's always-present global layer.
      commands: [],
      navGroups,
    };
  }, [sections, goToSection]);

  useBeakerSearchSource(source);
}
