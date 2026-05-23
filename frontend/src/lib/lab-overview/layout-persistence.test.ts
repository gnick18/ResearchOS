import { describe, it, expect } from "vitest";
import { resolveLayout } from "./layout-persistence";
import {
  visibleCatalog,
  type WidgetDefinition,
} from "@/components/lab-overview/widgets/types";
import type { LabOverviewLayout } from "@/lib/settings/user-settings";

/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * unit tests for the layout resolver. Covers the three load-bearing
 * promises in the brief:
 *   - missing layout → account-type-appropriate default
 *   - unknown widget id in saved layout → silently dropped
 *   - new catalog widget not in saved layout → appended at bottom
 *
 * `resolveLayout` is the pure core (no I/O) so we can test it without
 * stubbing the file system.
 */

const NullComponent = () => null;

const fakeCatalog: WidgetDefinition[] = [
  {
    id: "announcements",
    title: "Announcements",
    Component: NullComponent,
    defaultLayout: { w: 12, h: 3 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "comment-feed",
    title: "Lab comments",
    Component: NullComponent,
    defaultLayout: { w: 8, h: 6 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "metrics",
    title: "Lab metrics",
    Component: NullComponent,
    defaultLayout: { w: 4, h: 6 },
    surface: "canvas",
    memberVisible: false,
  },
  {
    id: "sidebar-recent-activity",
    title: "Recent lab activity",
    Component: NullComponent,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-overdue",
    title: "Overdue",
    Component: NullComponent,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
];

describe("resolveLayout", () => {
  it("falls back to the lab_head default when saved is undefined", () => {
    const layout = resolveLayout(undefined, "lab_head", fakeCatalog);
    // lab_head default has announcements + comment-feed + metrics on canvas
    expect(Object.keys(layout.canvas).sort()).toEqual([
      "announcements",
      "comment-feed",
      "metrics",
    ]);
    expect(layout.sidebar.order).toContain("sidebar-recent-activity");
  });

  it("falls back to the member default when saved is undefined", () => {
    // Member callers pass a visibility-filtered catalog (no PI-only widgets).
    const memberCatalog = visibleCatalog(fakeCatalog, "member");
    const layout = resolveLayout(undefined, "member", memberCatalog);
    // Member default: no metrics widget on canvas (it's lab_head only).
    expect(Object.keys(layout.canvas).sort()).toEqual([
      "announcements",
      "comment-feed",
    ]);
    expect(layout.sidebar.order).toContain("sidebar-overdue");
  });

  it("drops unknown widget ids from the saved canvas", () => {
    const saved: LabOverviewLayout = {
      version: 1,
      canvas: {
        announcements: { x: 0, y: 0, w: 12, h: 3 },
        // This id is not in the catalog — it must be silently dropped.
        "ancient-widget-from-r1": { x: 0, y: 3, w: 6, h: 4 },
      },
      sidebar: { order: ["sidebar-overdue"], hidden: [] },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(layout.canvas).not.toHaveProperty("ancient-widget-from-r1");
    expect(layout.canvas).toHaveProperty("announcements");
  });

  it("appends new catalog widgets that aren't in the saved canvas at the bottom", () => {
    const saved: LabOverviewLayout = {
      version: 1,
      canvas: {
        announcements: { x: 0, y: 0, w: 12, h: 3 },
        // comment-feed + metrics are in the catalog but missing here —
        // they should be appended below announcements, in catalog order.
      },
      sidebar: { order: [], hidden: [] },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(layout.canvas).toHaveProperty("comment-feed");
    expect(layout.canvas).toHaveProperty("metrics");
    // Announcements stays at y=0; appended widgets land below it.
    expect(layout.canvas.announcements.y).toBe(0);
    expect(layout.canvas["comment-feed"].y).toBeGreaterThanOrEqual(3);
    expect(layout.canvas.metrics.y).toBeGreaterThan(layout.canvas["comment-feed"].y);
  });

  it("preserves the user's custom positions for widgets they've moved", () => {
    const saved: LabOverviewLayout = {
      version: 1,
      canvas: {
        announcements: { x: 6, y: 4, w: 6, h: 2 }, // user moved + resized
      },
      sidebar: { order: [], hidden: [] },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(layout.canvas.announcements).toEqual({ x: 6, y: 4, w: 6, h: 2 });
  });

  it("appends new sidebar catalog widgets to the end of order, un-hidden", () => {
    const saved: LabOverviewLayout = {
      version: 1,
      canvas: {},
      sidebar: { order: ["sidebar-overdue"], hidden: [] },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    // sidebar-recent-activity is a catalog entry not in saved order; gets appended.
    expect(layout.sidebar.order).toContain("sidebar-recent-activity");
    expect(layout.sidebar.hidden).not.toContain("sidebar-recent-activity");
    // Existing entry stays at its position.
    expect(layout.sidebar.order[0]).toBe("sidebar-overdue");
  });

  it("visibleCatalog filters out PI-only widgets for members", () => {
    const memberCatalog = visibleCatalog(fakeCatalog, "member");
    expect(memberCatalog.map((w) => w.id)).not.toContain("metrics");
    expect(memberCatalog.map((w) => w.id)).toContain("announcements");
  });

  it("visibleCatalog returns everything for lab_head", () => {
    const piCatalog = visibleCatalog(fakeCatalog, "lab_head");
    expect(piCatalog.map((w) => w.id)).toContain("metrics");
    expect(piCatalog.length).toBe(fakeCatalog.length);
  });

  it("dedupes any duplicate sidebar order entries from a hand-edited blob", () => {
    const saved: LabOverviewLayout = {
      version: 1,
      canvas: {},
      sidebar: {
        order: ["sidebar-overdue", "sidebar-overdue", "sidebar-overdue"],
        hidden: [],
      },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(
      layout.sidebar.order.filter((id) => id === "sidebar-overdue").length,
    ).toBe(1);
  });
});
