import { describe, it, expect } from "vitest";
import {
  LAB_OVERVIEW_LAYOUT_VERSION,
  WIDGET_ID_RENAMES,
  defaultHomeLayoutFor,
  migrateLayoutToV2,
  resolveHomeLayout,
  resolveLayout,
} from "./layout-persistence";
import {
  visibleCatalog,
  widgetHasSurface,
  type WidgetDefinition,
} from "@/components/lab-overview/widgets/types";
import type {
  LabOverviewLayout,
  LabOverviewLayoutV1,
} from "@/lib/settings/user-settings";

/**
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * unit tests for the layout resolver + the v1 → v2 migration.
 *
 * Covers:
 *   - missing layout → account-type-appropriate default (v2 shape)
 *   - unknown widget id in saved layout → silently dropped
 *   - new catalog widget not in saved layout → appended at end
 *   - v1 free-grid → v2 ordered-list migration: y ASC, x ASC sort for
 *     canvas; sidebar = order minus hidden
 *   - migration idempotence: feeding a v2 payload back through returns
 *     an equivalent v2 payload, not a doubly-migrated mess
 *
 * `resolveLayout` is the pure core (no I/O) so we can test it without
 * stubbing the file system.
 */

const NullSnapshot = () => null;
const NullSidebar = () => null;

const fakeCatalog: WidgetDefinition[] = [
  {
    id: "announcements",
    toolId: "announcements",
    title: "Announcements",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 12, h: 3 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "comment-feed",
    toolId: "comments",
    title: "Lab comments",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 8, h: 6 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "metrics",
    toolId: "metrics",
    title: "Lab metrics",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 4, h: 6 },
    surface: "canvas",
    memberVisible: false,
  },
  {
    id: "sidebar-recent-activity",
    toolId: "recent-activity",
    title: "Recent lab activity",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-overdue",
    toolId: "daily-tasks",
    variantId: "overdue",
    title: "Overdue",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
];

describe("resolveLayout (v2 shape)", () => {
  it("falls back to the lab_head default when saved is undefined", () => {
    const layout = resolveLayout(undefined, "lab_head", fakeCatalog);
    expect(layout.version).toBe(LAB_OVERVIEW_LAYOUT_VERSION);
    // The full lab_head default declares 7 canvas widgets (commit
    // 18baedb2: lab head canvas default layout surfaces every lab-head
    // widget on first load). The fakeCatalog here only registers 3 of
    // them; resolveLayout drops the rest, so the surviving order is the
    // default order with the missing ids filtered out.
    expect(layout.widgetOrder.canvas).toEqual([
      "announcements",
      "metrics",
      "comment-feed",
    ]);
    expect(layout.widgetOrder.sidebar).toContain("sidebar-recent-activity");
  });

  it("falls back to the member default when saved is undefined", () => {
    const memberCatalog = visibleCatalog(fakeCatalog, "member");
    const layout = resolveLayout(undefined, "member", memberCatalog);
    expect(layout.widgetOrder.canvas).toEqual([
      "announcements",
      "comment-feed",
    ]);
    expect(layout.widgetOrder.sidebar).toContain("sidebar-overdue");
    // No metrics for members
    expect(layout.widgetOrder.canvas).not.toContain("metrics");
  });

  it("drops unknown widget ids from the saved canvas", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["announcements", "ancient-widget-from-r1"],
        sidebar: ["sidebar-overdue"],
      },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(layout.widgetOrder.canvas).not.toContain("ancient-widget-from-r1");
    expect(layout.widgetOrder.canvas).toContain("announcements");
  });

  it("appends new catalog widgets that aren't in the saved canvas at the end", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["announcements"],
        sidebar: [],
      },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(layout.widgetOrder.canvas[0]).toBe("announcements");
    expect(layout.widgetOrder.canvas).toContain("comment-feed");
    expect(layout.widgetOrder.canvas).toContain("metrics");
    // Appended widgets come AFTER the user's saved entry.
    const idxAnnouncements = layout.widgetOrder.canvas.indexOf("announcements");
    const idxCommentFeed = layout.widgetOrder.canvas.indexOf("comment-feed");
    expect(idxCommentFeed).toBeGreaterThan(idxAnnouncements);
  });

  it("preserves the user's custom order for widgets they've moved", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["metrics", "announcements", "comment-feed"],
        sidebar: [],
      },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(layout.widgetOrder.canvas).toEqual([
      "metrics",
      "announcements",
      "comment-feed",
    ]);
  });

  it("appends new sidebar catalog widgets to the end of order", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: [],
        sidebar: ["sidebar-overdue"],
      },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(layout.widgetOrder.sidebar).toContain("sidebar-recent-activity");
    expect(layout.widgetOrder.sidebar[0]).toBe("sidebar-overdue");
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
      version: 2,
      widgetOrder: {
        canvas: [],
        sidebar: ["sidebar-overdue", "sidebar-overdue", "sidebar-overdue"],
      },
    };
    const layout = resolveLayout(saved, "lab_head", fakeCatalog);
    expect(
      layout.widgetOrder.sidebar.filter((id) => id === "sidebar-overdue").length,
    ).toBe(1);
  });
});

describe("migrateLayoutToV2", () => {
  it("returns undefined when input is undefined", () => {
    expect(migrateLayoutToV2(undefined)).toBeUndefined();
  });

  it("sorts the v1 canvas by y ASC then x ASC and flattens to id list", () => {
    const v1: LabOverviewLayoutV1 = {
      version: 1,
      canvas: {
        // Intentionally unordered to exercise the sort. Expected output
        // order: announcements (y=0), comment-feed (y=3,x=0), metrics
        // (y=3,x=8), lab-notes (y=9).
        metrics: { x: 8, y: 3, w: 4, h: 6 },
        "comment-feed": { x: 0, y: 3, w: 8, h: 6 },
        "lab-notes": { x: 0, y: 9, w: 6, h: 6 },
        announcements: { x: 0, y: 0, w: 12, h: 3 },
      },
      sidebar: { order: [], hidden: [] },
    };
    const migrated = migrateLayoutToV2(v1)!;
    expect(migrated.version).toBe(LAB_OVERVIEW_LAYOUT_VERSION);
    expect(migrated.widgetOrder.canvas).toEqual([
      "announcements",
      "comment-feed",
      "metrics",
      "lab-notes",
    ]);
  });

  it("drops hidden sidebar ids from the migrated order", () => {
    const v1: LabOverviewLayoutV1 = {
      version: 1,
      canvas: {},
      sidebar: {
        order: [
          "sidebar-recent-activity",
          "sidebar-pi-actions",
          "sidebar-overdue",
        ],
        hidden: ["sidebar-overdue"],
      },
    };
    const migrated = migrateLayoutToV2(v1)!;
    expect(migrated.widgetOrder.sidebar).toEqual([
      "sidebar-recent-activity",
      "sidebar-pi-actions",
    ]);
    expect(migrated.widgetOrder.sidebar).not.toContain("sidebar-overdue");
  });

  it("is idempotent on a v2 payload (no double migration)", () => {
    const v2: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["announcements", "comment-feed", "metrics"],
        sidebar: ["sidebar-recent-activity"],
      },
    };
    const once = migrateLayoutToV2(v2)!;
    const twice = migrateLayoutToV2(once)!;
    expect(once.widgetOrder).toEqual(v2.widgetOrder);
    expect(twice.widgetOrder).toEqual(v2.widgetOrder);
    expect(twice.version).toBe(LAB_OVERVIEW_LAYOUT_VERSION);
  });

  it("WIDGET_ID_RENAMES starts empty (Phase C kept every existing id)", () => {
    // The Phase C tools refactor added NEW widget ids for the purchases
    // variants (lab-purchases-burn-rate, lab-purchases-pending-count) but
    // did NOT rename any existing id. So the renames map is empty.
    // If a future refactor renames a widget id, add the mapping and a
    // test that exercises it through resolveLayout.
    expect(Object.keys(WIDGET_ID_RENAMES).length).toBe(0);
  });

  it("widgetHasSurface translates legacy `surface` field for canvas+sidebar", () => {
    const legacyCanvas: WidgetDefinition = {
      id: "x",
      toolId: "x",
      title: "x",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 1, h: 1 },
      surface: "canvas",
      memberVisible: true,
    };
    expect(widgetHasSurface(legacyCanvas, "canvas")).toBe(true);
    expect(widgetHasSurface(legacyCanvas, "sidebar")).toBe(false);
    expect(widgetHasSurface(legacyCanvas, "home")).toBe(false);

    const legacyBoth: WidgetDefinition = { ...legacyCanvas, surface: "both" };
    expect(widgetHasSurface(legacyBoth, "canvas")).toBe(true);
    expect(widgetHasSurface(legacyBoth, "sidebar")).toBe(true);
    // Legacy "both" never auto-infers home — home is opt-in only.
    expect(widgetHasSurface(legacyBoth, "home")).toBe(false);
  });

  it("widgetHasSurface prefers the new `surfaces` map when both are present", () => {
    const ported: WidgetDefinition = {
      id: "x",
      toolId: "x",
      title: "x",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 1, h: 1 },
      // surfaces wins over surface when both are present
      surface: "canvas",
      surfaces: { home: true, sidebar: true },
      memberVisible: true,
    };
    expect(widgetHasSurface(ported, "canvas")).toBe(false);
    expect(widgetHasSurface(ported, "sidebar")).toBe(true);
    expect(widgetHasSurface(ported, "home")).toBe(true);
  });

  it("resolveLayout migrates a v1 payload end-to-end", () => {
    const v1: LabOverviewLayoutV1 = {
      version: 1,
      canvas: {
        metrics: { x: 8, y: 3, w: 4, h: 6 },
        announcements: { x: 0, y: 0, w: 12, h: 3 },
        "comment-feed": { x: 0, y: 3, w: 8, h: 6 },
      },
      sidebar: {
        order: ["sidebar-recent-activity", "sidebar-overdue"],
        hidden: ["sidebar-overdue"],
      },
    };
    const layout = resolveLayout(v1, "lab_head", fakeCatalog);
    expect(layout.version).toBe(LAB_OVERVIEW_LAYOUT_VERSION);
    expect(layout.widgetOrder.canvas).toEqual([
      "announcements",
      "comment-feed",
      "metrics",
    ]);
    // sidebar-overdue was hidden in v1; after migration it drops out of
    // the saved order. resolveLayout then re-appends it (every catalog
    // widget not in the saved list is appended at the end) — so the
    // post-migrate-then-resolve sidebar has sidebar-recent-activity
    // FIRST (saved position) and sidebar-overdue LAST (re-appended from
    // catalog). Idiomatic: v1 "hidden" meant "I don't see this today",
    // not "delete forever"; the new model surfaces all catalog entries
    // unless the user explicitly removes them post-migration.
    expect(layout.widgetOrder.sidebar[0]).toBe("sidebar-recent-activity");
    expect(layout.widgetOrder.sidebar).toContain("sidebar-overdue");
    const idxRecent = layout.widgetOrder.sidebar.indexOf("sidebar-recent-activity");
    const idxOverdue = layout.widgetOrder.sidebar.indexOf("sidebar-overdue");
    expect(idxOverdue).toBeGreaterThan(idxRecent);
  });
});

/**
 * Home canvas migration (Home canvas migration manager, 2026-05-23):
 * tests for the new `home_layout` reader / mutator + `defaultHomeLayoutFor`.
 *
 * The home canvas reads from a separate settings field (`home_layout`,
 * not `lab_overview_layout`), filters the catalog by the `home` surface
 * (not `canvas`), and uses a smaller curated default. Unlike the
 * lab-overview reader, the home reader does NOT auto-append every
 * home-eligible catalog widget — home is user-curated.
 */
describe("resolveHomeLayout + defaultHomeLayoutFor", () => {
  const homeCatalog: WidgetDefinition[] = [
    {
      id: "announcements",
      toolId: "announcements",
      title: "Announcements",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 12, h: 3 },
      surfaces: { canvas: true, home: true },
      memberVisible: true,
    },
    {
      id: "comment-feed",
      toolId: "comments",
      title: "Lab comments",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 8, h: 6 },
      surfaces: { canvas: true, home: true },
      memberVisible: true,
    },
    {
      id: "lab-activity",
      toolId: "lab-activity",
      title: "Lab activity",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 6, h: 8 },
      surfaces: { canvas: true, home: true },
      memberVisible: true,
    },
    {
      id: "sidebar-todays-announcements",
      toolId: "todays-announcements",
      title: "Today's announcements",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 1, h: 1 },
      surfaces: { sidebar: true, canvas: true, home: true },
      memberVisible: true,
    },
    {
      id: "metrics",
      toolId: "metrics",
      title: "Lab metrics",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 4, h: 6 },
      // PI-only dashboard, NOT home-eligible. The home reader should
      // drop this id if it ever appears in a saved home layout.
      surfaces: { canvas: true },
      memberVisible: false,
    },
  ];

  it("falls back to the member default when home_layout is undefined", () => {
    const layout = resolveHomeLayout(undefined, "member", homeCatalog);
    expect(layout.version).toBe(LAB_OVERVIEW_LAYOUT_VERSION);
    // The four Grant-called-out signals, in order.
    expect(layout.widgetOrder.canvas).toEqual([
      "announcements",
      "comment-feed",
      "lab-activity",
      "sidebar-todays-announcements",
    ]);
    // Home doesn't use the sidebar axis (today).
    expect(layout.widgetOrder.sidebar).toEqual([]);
  });

  it("uses the same default for lab heads (they get /lab-overview for the dense dashboard)", () => {
    const memberDefault = defaultHomeLayoutFor("member");
    const headDefault = defaultHomeLayoutFor("lab_head");
    expect(headDefault.widgetOrder.canvas).toEqual(
      memberDefault.widgetOrder.canvas,
    );
  });

  it("drops widget ids that aren't home-eligible", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        // metrics is canvas-only, not home — it must NOT survive.
        canvas: ["announcements", "metrics", "comment-feed"],
        sidebar: [],
      },
    };
    const layout = resolveHomeLayout(saved, "lab_head", homeCatalog);
    expect(layout.widgetOrder.canvas).toEqual([
      "announcements",
      "comment-feed",
    ]);
    expect(layout.widgetOrder.canvas).not.toContain("metrics");
  });

  it("preserves the user's custom order", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["lab-activity", "announcements"],
        sidebar: [],
      },
    };
    const layout = resolveHomeLayout(saved, "member", homeCatalog);
    expect(layout.widgetOrder.canvas).toEqual([
      "lab-activity",
      "announcements",
    ]);
  });

  it("does NOT auto-append home-eligible widgets to a user's saved layout", () => {
    // /home is user-curated: a new home-eligible widget in the catalog
    // does NOT silently appear in everyone's saved layout. (This is the
    // opposite of /lab-overview, which is a dashboard and does append.)
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["announcements"],
        sidebar: [],
      },
    };
    const layout = resolveHomeLayout(saved, "member", homeCatalog);
    expect(layout.widgetOrder.canvas).toEqual(["announcements"]);
    expect(layout.widgetOrder.canvas).not.toContain("comment-feed");
  });

  it("drops unknown widget ids from the saved home canvas", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["announcements", "deleted-widget-from-prior-version"],
        sidebar: [],
      },
    };
    const layout = resolveHomeLayout(saved, "member", homeCatalog);
    expect(layout.widgetOrder.canvas).toEqual(["announcements"]);
  });
});
