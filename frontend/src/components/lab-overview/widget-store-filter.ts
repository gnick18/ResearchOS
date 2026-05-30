/**
 * Widget store FILTERING (Extension Store Phase C, store-search bot,
 * 2026-05-29).
 *
 * Pure, synchronous filter helpers for the widget store's center list and
 * category counts so they can be unit-tested without rendering. The store
 * modal owns React state (search text, selected category, enabled-only) and
 * the enablement set; this module only computes what the rail + center column
 * should show.
 *
 * The category SET is derived from the full (account/surface-gated) eligible
 * catalog, so the tool grouping stays stable as the user types, while the
 * per-category COUNTS reflect the current search + enabled-only state. Empty
 * categories are dropped, except the currently selected one stays visible so
 * the selection never silently disappears.
 */

import type { WidgetDefinition } from "./widgets/types";

/** Sentinel category id for the single-variant catch-all bucket. */
export const OTHER_WIDGET_CATEGORY_ID = "__other__";

export interface WidgetCategoryGroup {
  toolId: string;
  label: string;
  widgets: WidgetDefinition[];
}

/**
 * Group an eligible catalog by Tool family, mirroring the canvas palette's
 * grouping so the two surfaces read the same. Tools with a single variant fall
 * into one "Other widgets" catch-all. Moved here from WidgetStoreModal so the
 * grouping and the filtering share one definition.
 */
export function groupWidgetsByTool(
  catalog: WidgetDefinition[],
): WidgetCategoryGroup[] {
  const byTool = new Map<string, WidgetDefinition[]>();
  for (const w of catalog) {
    const list = byTool.get(w.toolId);
    if (list) list.push(w);
    else byTool.set(w.toolId, [w]);
  }
  const multi: WidgetCategoryGroup[] = [];
  const singletons: WidgetDefinition[] = [];
  for (const [toolId, widgets] of byTool) {
    if (widgets.length > 1) {
      const label = widgets
        .map((w) => w.title)
        .reduce((a, b) => (b.length < a.length ? b : a));
      multi.push({ toolId, label, widgets });
    } else {
      singletons.push(widgets[0]);
    }
  }
  if (singletons.length > 0) {
    multi.push({
      toolId: OTHER_WIDGET_CATEGORY_ID,
      label: "Other widgets",
      widgets: singletons,
    });
  }
  return multi;
}

/** Does a widget match the search query? Matches title, description, toolId.
 *  An empty / whitespace query matches everything. */
export function widgetMatchesSearch(
  widget: WidgetDefinition,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    widget.title.toLowerCase().includes(q) ||
    (widget.description ?? "").toLowerCase().includes(q) ||
    widget.toolId.toLowerCase().includes(q)
  );
}

export interface WidgetStoreFilterInput {
  /** The account/surface-gated catalog (the universe the store may show). */
  eligible: WidgetDefinition[];
  /** Stable tool grouping, derived once from the full eligible catalog. */
  groups: WidgetCategoryGroup[];
  query: string;
  enabledOnly: boolean;
  /** Resolved enabled widget ids (base ids). */
  enabledIds: Set<string>;
  /** Selected category id, or null for "All". */
  selectedCategoryId: string | null;
}

export interface StoreFilterCategory {
  id: string;
  label: string;
  count: number;
}

export interface WidgetStoreFilterResult {
  categories: StoreFilterCategory[];
  items: WidgetDefinition[];
}

/**
 * Compute the rail categories (with live counts) and the center-column items
 * for the widget store given the current search + enabled-only + selected
 * category. Counts reflect search + enabled-only; the category set stays stable
 * from `groups` (empty categories dropped, selected one kept).
 */
export function filterWidgetStore({
  eligible,
  groups,
  query,
  enabledOnly,
  enabledIds,
  selectedCategoryId,
}: WidgetStoreFilterInput): WidgetStoreFilterResult {
  const categoryOf = new Map<string, string>();
  for (const g of groups) {
    for (const w of g.widgets) categoryOf.set(w.id, g.toolId);
  }

  const matched = eligible.filter(
    (w) =>
      widgetMatchesSearch(w, query) && (!enabledOnly || enabledIds.has(w.id)),
  );

  const categories: StoreFilterCategory[] = groups
    .map((g) => ({
      id: g.toolId,
      label: g.label,
      count: matched.filter((w) => categoryOf.get(w.id) === g.toolId).length,
    }))
    .filter((c) => c.count > 0 || c.id === selectedCategoryId);

  const items =
    selectedCategoryId === null
      ? matched
      : matched.filter((w) => categoryOf.get(w.id) === selectedCategoryId);

  return { categories, items };
}
