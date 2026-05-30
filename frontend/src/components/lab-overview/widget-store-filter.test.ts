// Extension Store Phase C (store-search bot) coverage for the widget store
// filter predicates: search over title / description / toolId, tool-family
// grouping, per-category live counts (reflecting search + enabled-only), and
// the center-list filtering by selected category.

import { describe, expect, it } from "vitest";
import type { WidgetDefinition } from "./widgets/types";
import {
  OTHER_WIDGET_CATEGORY_ID,
  filterWidgetStore,
  groupWidgetsByTool,
  widgetMatchesSearch,
} from "./widget-store-filter";

/** Minimal WidgetDefinition fixture; the filter only reads id/title/
 *  description/toolId, so the rest is irrelevant. */
function w(
  id: string,
  title: string,
  toolId: string,
  description?: string,
): WidgetDefinition {
  return { id, title, toolId, description } as unknown as WidgetDefinition;
}

const A1 = w("a1", "Alpha One", "alpha", "first alpha widget");
const A2 = w("a2", "Alpha Two", "alpha", "second alpha");
const B1 = w("b1", "Beta", "beta", "only beta");
const C1 = w("c1", "Gamma widget", "gamma", "solo gamma counter");
const EVERY = [A1, A2, B1, C1];

describe("groupWidgetsByTool", () => {
  it("groups multi-variant tools and buckets singletons into Other widgets", () => {
    const groups = groupWidgetsByTool(EVERY);
    const alpha = groups.find((g) => g.toolId === "alpha");
    const other = groups.find((g) => g.toolId === OTHER_WIDGET_CATEGORY_ID);
    expect(alpha?.widgets).toEqual([A1, A2]);
    expect(alpha?.label).toBe("Alpha One"); // shortest-title rule
    expect(other?.widgets).toEqual([B1, C1]);
    expect(other?.label).toBe("Other widgets");
  });

  it("omits the Other bucket when every tool has multiple variants", () => {
    const groups = groupWidgetsByTool([A1, A2]);
    expect(groups).toHaveLength(1);
    expect(groups.map((g) => g.toolId)).not.toContain(OTHER_WIDGET_CATEGORY_ID);
  });
});

describe("widgetMatchesSearch", () => {
  it("matches the empty / whitespace query against everything", () => {
    expect(widgetMatchesSearch(A1, "")).toBe(true);
    expect(widgetMatchesSearch(A1, "   ")).toBe(true);
  });

  it("matches on title, description, and toolId, case-insensitively", () => {
    expect(widgetMatchesSearch(A1, "alpha one")).toBe(true); // title
    expect(widgetMatchesSearch(A1, "FIRST alpha")).toBe(true); // description
    expect(widgetMatchesSearch(B1, "BETA")).toBe(true); // toolId + title
    expect(widgetMatchesSearch(A1, "gamma")).toBe(false);
  });
});

describe("filterWidgetStore", () => {
  const groups = groupWidgetsByTool(EVERY);
  const base = {
    eligible: EVERY,
    groups,
    enabledIds: new Set<string>(),
  };

  it("returns everything with stable counts when unfiltered", () => {
    const { categories, items } = filterWidgetStore({
      ...base,
      query: "",
      enabledOnly: false,
      selectedCategoryId: null,
    });
    expect(items).toEqual(EVERY);
    expect(categories).toEqual([
      { id: "alpha", label: "Alpha One", count: 2 },
      { id: OTHER_WIDGET_CATEGORY_ID, label: "Other widgets", count: 2 },
    ]);
    // The shell sums category counts for the "All" badge.
    const allCount = categories.reduce((s, c) => s + c.count, 0);
    expect(allCount).toBe(items.length);
  });

  it("narrows items and recomputes counts on search", () => {
    const { categories, items } = filterWidgetStore({
      ...base,
      query: "alpha",
      enabledOnly: false,
      selectedCategoryId: null,
    });
    expect(items).toEqual([A1, A2]);
    // The Other bucket drops out (0 matches), alpha keeps 2.
    expect(categories).toEqual([{ id: "alpha", label: "Alpha One", count: 2 }]);
  });

  it("keeps a selected-but-empty category visible at count 0", () => {
    const { categories } = filterWidgetStore({
      ...base,
      query: "alpha",
      enabledOnly: false,
      selectedCategoryId: OTHER_WIDGET_CATEGORY_ID,
    });
    const other = categories.find(
      (c) => c.id === OTHER_WIDGET_CATEGORY_ID,
    );
    expect(other?.count).toBe(0);
  });

  it("filters to enabled widgets when enabledOnly is on", () => {
    const { categories, items } = filterWidgetStore({
      ...base,
      enabledIds: new Set(["a1", "b1"]),
      query: "",
      enabledOnly: true,
      selectedCategoryId: null,
    });
    expect(items).toEqual([A1, B1]);
    expect(categories).toEqual([
      { id: "alpha", label: "Alpha One", count: 1 },
      { id: OTHER_WIDGET_CATEGORY_ID, label: "Other widgets", count: 1 },
    ]);
  });

  it("narrows the center list to the selected category", () => {
    const { items } = filterWidgetStore({
      ...base,
      query: "",
      enabledOnly: false,
      selectedCategoryId: "alpha",
    });
    expect(items).toEqual([A1, A2]);
  });

  it("composes search + enabled-only + category", () => {
    const { items } = filterWidgetStore({
      ...base,
      enabledIds: new Set(["a1"]),
      query: "alpha",
      enabledOnly: true,
      selectedCategoryId: "alpha",
    });
    expect(items).toEqual([A1]);
  });
});
