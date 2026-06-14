// Pure view model for the add-figure picker. Turns a flat FigureRef[] into the
// filtered + grouped structure the gallery renders, plus the distinct plot-type
// labels for the filter chips. No DOM, no rendering, so the component stays thin
// and this logic is unit-tested.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type { FigureRef } from "@/lib/figure/figure-source";

/** How the visible figures are arranged in the list. */
export type GroupBy = "table" | "type" | "none";

export interface PickerGroup {
  /** The group heading ("Drug screen", "XY", or "" for the flat list). */
  label: string;
  refs: FigureRef[];
}

export interface PickerView {
  /** Distinct plot-type labels present, for the filter chips (excludes "All"). */
  kinds: string[];
  /** The filtered, grouped figures to render. */
  groups: PickerGroup[];
  /** How many figures matched the filter + query, across all groups. */
  count: number;
}

const FALLBACK_KIND = "Other";

/** A figure's plot-type label, falling back when a source did not set one. */
export function refKind(ref: FigureRef): string {
  return ref.kind && ref.kind.trim() ? ref.kind : FALLBACK_KIND;
}

/** A figure's sub-group label, falling back to the source label when absent. */
export function refGroup(ref: FigureRef, sourceLabel: string): string {
  return ref.group && ref.group.trim() ? ref.group : sourceLabel;
}

/**
 * Build the picker view model: the distinct kinds (for chips) plus the refs
 * filtered by kind + free-text query, then grouped by the chosen axis. Input
 * order is preserved within and across groups so the list is stable.
 */
export function buildPickerView(
  refs: FigureRef[],
  opts: {
    /** A kind label to keep, or null for "All". */
    kindFilter: string | null;
    groupBy: GroupBy;
    query: string;
    /** Source label used as the group fallback when a ref has no group. */
    sourceLabel: string;
  },
): PickerView {
  const { kindFilter, groupBy, query, sourceLabel } = opts;
  const q = query.trim().toLowerCase();

  // Distinct kinds for the chips, in first-seen order.
  const kinds: string[] = [];
  for (const r of refs) {
    const k = refKind(r);
    if (!kinds.includes(k)) kinds.push(k);
  }

  const matched = refs.filter((r) => {
    if (kindFilter && refKind(r) !== kindFilter) return false;
    if (!q) return true;
    const hay = `${r.name} ${refGroup(r, sourceLabel)} ${refKind(r)}`.toLowerCase();
    return hay.includes(q);
  });

  let groups: PickerGroup[];
  if (groupBy === "none") {
    groups = matched.length ? [{ label: "", refs: matched }] : [];
  } else {
    const keyOf = (r: FigureRef) =>
      groupBy === "table" ? refGroup(r, sourceLabel) : refKind(r);
    const order: string[] = [];
    const byKey = new Map<string, FigureRef[]>();
    for (const r of matched) {
      const k = keyOf(r);
      if (!byKey.has(k)) {
        byKey.set(k, []);
        order.push(k);
      }
      byKey.get(k)!.push(r);
    }
    groups = order.map((label) => ({ label, refs: byKey.get(label)! }));
  }

  return { kinds, groups, count: matched.length };
}
