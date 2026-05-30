/**
 * Method library FILTERING (Extension Store Phase C, store-search bot,
 * 2026-05-29).
 *
 * Pure, synchronous filter helpers for the method library's Types | Templates
 * segment so the rail categories, their live counts, and the center list can
 * be unit-tested without rendering. The modal owns React state (segment,
 * search text, selected category, enabled-only) and the enabled-types set;
 * this module only computes what the rail + center column should show.
 *
 * The segment switches BOTH the category set and the item kind:
 *   - TYPES view: categories are the registry `category` field
 *     (Standard / Structured); items are method-type modules. Enabled-only
 *     narrows to the account's enabled types.
 *   - TEMPLATES view: categories are the manifest `category` values
 *     (Molecular biology, Analytical chemistry, ...); items are templates.
 *     Enabled-only does NOT hide a template whose underlying type is disabled:
 *     templates stay discoverable, and the gated action is Phase D's job.
 *
 * As with the widget store, the category SET is stable (derived from the full
 * list) while COUNTS reflect the current search + enabled-only. Empty
 * categories are dropped, except the selected one stays visible.
 */

import type { MethodCatalogManifestEntry } from "@/lib/methods/method-catalog";
import type { MethodModuleMeta } from "@/lib/methods/method-module";
import type { MethodTypeId } from "@/lib/methods/method-type-registry";

export type MethodLibrarySegment = "types" | "templates";

export interface StoreFilterCategory {
  id: string;
  label: string;
  count: number;
}

/** Fixed Standard / Structured ordering for the Types view, matching the
 *  registry `category` discriminator + the new-method picker sections. */
const TYPE_CATEGORY_ORDER: { id: "standard" | "structured"; label: string }[] =
  [
    { id: "standard", label: "Standard" },
    { id: "structured", label: "Structured" },
  ];

/** Does a method TYPE match the search query? Matches label + description.
 *  Empty query matches everything. */
export function typeMatchesSearch(
  module: MethodModuleMeta,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    module.cosmetic.label.toLowerCase().includes(q) ||
    (module.cosmetic.description ?? "").toLowerCase().includes(q)
  );
}

/** Does a TEMPLATE match the search query? Matches title + tags. Empty query
 *  matches everything. */
export function templateMatchesSearch(
  entry: MethodCatalogManifestEntry,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  if (entry.title.toLowerCase().includes(q)) return true;
  return (entry.tags ?? []).some((t) => t.toLowerCase().includes(q));
}

export interface TypeViewFilterInput {
  modules: MethodModuleMeta[];
  query: string;
  enabledOnly: boolean;
  /** Resolved enabled method-type ids. */
  enabledIds: Set<MethodTypeId>;
  selectedCategoryId: string | null;
}

export interface TypeViewFilterResult {
  categories: StoreFilterCategory[];
  items: MethodModuleMeta[];
}

/** Types-view categories (Standard / Structured) + center items. */
export function filterTypeView({
  modules,
  query,
  enabledOnly,
  enabledIds,
  selectedCategoryId,
}: TypeViewFilterInput): TypeViewFilterResult {
  const matched = modules.filter(
    (m) =>
      typeMatchesSearch(m, query) && (!enabledOnly || enabledIds.has(m.id)),
  );

  const categories: StoreFilterCategory[] = TYPE_CATEGORY_ORDER.map((c) => ({
    id: c.id,
    label: c.label,
    count: matched.filter((m) => m.cosmetic.category === c.id).length,
  })).filter((c) => c.count > 0 || c.id === selectedCategoryId);

  const items =
    selectedCategoryId === null
      ? matched
      : matched.filter((m) => m.cosmetic.category === selectedCategoryId);

  return { categories, items };
}

/** Distinct template categories in first-seen order, derived from the full
 *  entry list so the category set stays stable as the user types. */
export function templateCategoryOrder(
  entries: MethodCatalogManifestEntry[],
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const e of entries) {
    if (!seen.has(e.category)) {
      seen.add(e.category);
      order.push(e.category);
    }
  }
  return order;
}

export interface TemplateViewFilterInput {
  entries: MethodCatalogManifestEntry[];
  query: string;
  selectedCategoryId: string | null;
}

export interface TemplateViewFilterResult {
  categories: StoreFilterCategory[];
  items: MethodCatalogManifestEntry[];
}

/**
 * Templates-view categories (manifest domain categories) + center items.
 * Enabled-only is intentionally NOT an input: templates whose underlying type
 * is disabled still show so they stay discoverable (Phase D gates the action).
 */
export function filterTemplateView({
  entries,
  query,
  selectedCategoryId,
}: TemplateViewFilterInput): TemplateViewFilterResult {
  const matched = entries.filter((e) => templateMatchesSearch(e, query));
  const order = templateCategoryOrder(entries);

  const categories: StoreFilterCategory[] = order
    .map((cat) => ({
      id: cat,
      label: cat,
      count: matched.filter((e) => e.category === cat).length,
    }))
    .filter((c) => c.count > 0 || c.id === selectedCategoryId);

  const items =
    selectedCategoryId === null
      ? matched
      : matched.filter((e) => e.category === selectedCategoryId);

  return { categories, items };
}
