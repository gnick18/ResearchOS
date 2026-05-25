// frontend/src/lib/lab-overview/__tests__/tool-registry.test.tsx
//
// Pins the 3-branch precedence of `resolveToolTitle` (widget popup-title
// override manager, 2026-05-25):
//   1. `widget.popupTitle` wins outright (catalog-side override; e.g. the
//      `sidebar-upcoming` tile of the daily-tasks Tool overrides the
//      umbrella "Today's tasks" header with its own "Upcoming tasks").
//   2. Otherwise the Tool registry's `title` (keeps multi-variant Tools
//      that don't set an override consistent — all 3 purchases variants
//      still resolve to "Lab purchases").
//   3. Otherwise the widget's own `title` (defensive fallback when the
//      `toolId` doesn't match any registered Tool).
//
// The test uses real toolIds from TOOL_REGISTRY rather than mocking
// `getTool`, so the precedence ladder is exercised against the actual
// registry the production code consults.

import { describe, it, expect } from "vitest";
import { resolveToolTitle } from "../tool-registry";

describe("resolveToolTitle", () => {
  it("returns popupTitle when set (highest precedence)", () => {
    // Even when the toolId resolves ("daily-tasks" -> "Today's tasks"),
    // the per-widget override must win. This is the load-bearing case
    // for sidebar tile variants of shared Tools.
    const widget = {
      toolId: "daily-tasks",
      title: "Upcoming tasks",
      popupTitle: "Upcoming tasks",
    };
    expect(resolveToolTitle(widget)).toBe("Upcoming tasks");
  });

  it("falls back to the registered Tool title when popupTitle is absent", () => {
    // The widget's own `title` ("Purchases sidebar") is intentionally
    // different from the Tool's title ("Lab purchases") so the test
    // would fail if the widget-title branch beat the Tool branch.
    const widget = {
      toolId: "purchases",
      title: "Purchases sidebar",
    };
    expect(resolveToolTitle(widget)).toBe("Lab purchases");
  });

  it("falls back to the widget's own title when no Tool matches", () => {
    // `__not-a-real-tool__` is not in TOOL_REGISTRY, so the resolver
    // must drop through to the widget's own `title`.
    const widget = {
      toolId: "__not-a-real-tool__",
      title: "Standalone widget title",
    };
    expect(resolveToolTitle(widget)).toBe("Standalone widget title");
  });
});
