import { describe, it, expect } from "vitest";
import {
  LAB_OVERVIEW_LAYOUT_VERSION,
  PROJECTS_OVERVIEW_WIDGET_ID,
  WIDGET_ID_RENAMES,
  dashboardSurfaceFor,
  defaultDashboardLayoutFor,
  defaultHomeLayoutFor,
  migrateLayoutToV2,
  resolveDashboardLayout,
  resolveHomeLayout,
  resolveLayout,
  seedDashboardLayout,
} from "./layout-persistence";
import {
  isWidgetVisibleForLabHead,
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

  // Widget per-surface visibility manager (2026-05-25): per-surface
  // lab-head visibility lets a single widget be home-eligible for lab
  // heads but sidebar-carved-out at the same time (e.g.
  // sidebar-upcoming). Visibility resolution per surface:
  //   labHeadVisibleOn?.<surface> ?? labHeadVisible ?? true
  describe("isWidgetVisibleForLabHead (per-surface)", () => {
    const perSurfaceWidget = {
      labHeadVisibleOn: { sidebar: false, home: true },
    };
    const legacyVisibleTrue = { labHeadVisible: true };
    const legacyVisibleFalse = { labHeadVisible: false };
    const noFields = {};

    it("reads the per-surface entry when set (sidebar=false, home=true)", () => {
      expect(isWidgetVisibleForLabHead(perSurfaceWidget, "sidebar")).toBe(false);
      expect(isWidgetVisibleForLabHead(perSurfaceWidget, "home")).toBe(true);
    });

    it("falls back to legacy labHeadVisible:true on all surfaces (back-compat)", () => {
      expect(isWidgetVisibleForLabHead(legacyVisibleTrue, "sidebar")).toBe(true);
      expect(isWidgetVisibleForLabHead(legacyVisibleTrue, "home")).toBe(true);
      expect(isWidgetVisibleForLabHead(legacyVisibleTrue, "canvas")).toBe(true);
    });

    it("falls back to legacy labHeadVisible:false on all surfaces (back-compat)", () => {
      expect(isWidgetVisibleForLabHead(legacyVisibleFalse, "sidebar")).toBe(false);
      expect(isWidgetVisibleForLabHead(legacyVisibleFalse, "home")).toBe(false);
      expect(isWidgetVisibleForLabHead(legacyVisibleFalse, "canvas")).toBe(false);
    });

    it("defaults to true when neither field is set", () => {
      expect(isWidgetVisibleForLabHead(noFields, "sidebar")).toBe(true);
      expect(isWidgetVisibleForLabHead(noFields, "home")).toBe(true);
      expect(isWidgetVisibleForLabHead(noFields, "canvas")).toBe(true);
    });

    it("per-surface entry wins over legacy labHeadVisible when both are set", () => {
      const conflicting = {
        labHeadVisible: false,
        labHeadVisibleOn: { home: true },
      };
      // home: per-surface true beats legacy false
      expect(isWidgetVisibleForLabHead(conflicting, "home")).toBe(true);
      // sidebar: no per-surface entry, falls back to legacy false
      expect(isWidgetVisibleForLabHead(conflicting, "sidebar")).toBe(false);
    });
  });

  describe("visibleCatalog (surface-scoped, per-surface lab-head visibility)", () => {
    // Three widgets, one of each shape, all home + sidebar surface
    // eligible for the purposes of this test:
    //   - newPerSurface: labHeadVisibleOn: { sidebar: false, home: true }
    //   - legacyTrue:    labHeadVisible: true
    //   - legacyFalse:   labHeadVisible: false
    const perSurfaceCatalog: WidgetDefinition[] = [
      {
        id: "new-per-surface",
        toolId: "daily-tasks",
        title: "Per-surface widget",
        SnapshotTile: NullSnapshot,
        SidebarTile: NullSidebar,
        defaultLayout: { w: 1, h: 1 },
        surfaces: { sidebar: true, home: true },
        memberVisible: true,
        labHeadVisibleOn: { sidebar: false, home: true },
      },
      {
        id: "legacy-true",
        toolId: "daily-tasks",
        title: "Legacy true",
        SnapshotTile: NullSnapshot,
        SidebarTile: NullSidebar,
        defaultLayout: { w: 1, h: 1 },
        surfaces: { sidebar: true, home: true },
        memberVisible: true,
        labHeadVisible: true,
      },
      {
        id: "legacy-false",
        toolId: "daily-tasks",
        title: "Legacy false",
        SnapshotTile: NullSnapshot,
        SidebarTile: NullSidebar,
        defaultLayout: { w: 1, h: 1 },
        surfaces: { sidebar: true, home: true },
        memberVisible: true,
        labHeadVisible: false,
      },
    ];

    it("home surface for PI: includes per-surface=home:true and legacy=true; excludes legacy=false", () => {
      const result = visibleCatalog(perSurfaceCatalog, "lab_head", "home");
      const ids = result.map((w) => w.id);
      expect(ids).toContain("new-per-surface");
      expect(ids).toContain("legacy-true");
      expect(ids).not.toContain("legacy-false");
    });

    it("sidebar surface for PI: excludes per-surface=sidebar:false AND legacy=false; includes legacy=true", () => {
      const result = visibleCatalog(perSurfaceCatalog, "lab_head", "sidebar");
      const ids = result.map((w) => w.id);
      expect(ids).not.toContain("new-per-surface");
      expect(ids).toContain("legacy-true");
      expect(ids).not.toContain("legacy-false");
    });

    it("members are unaffected by the per-surface lab-head fields", () => {
      // All three widgets carry memberVisible: true so members see them
      // on any surface call.
      const home = visibleCatalog(perSurfaceCatalog, "member", "home");
      const sidebar = visibleCatalog(perSurfaceCatalog, "member", "sidebar");
      expect(home.map((w) => w.id).sort()).toEqual(
        ["legacy-false", "legacy-true", "new-per-surface"].sort(),
      );
      expect(sidebar.map((w) => w.id).sort()).toEqual(
        ["legacy-false", "legacy-true", "new-per-surface"].sort(),
      );
    });

    it("without a surface arg, lab_head still gets the legacy-shape filter (back-compat)", () => {
      // No surface arg → legacy behavior: drop only entries that set
      // labHeadVisible: false explicitly. The per-surface widget is
      // kept (its labHeadVisible is unset; surface-scoped consumers
      // filter further downstream).
      const result = visibleCatalog(perSurfaceCatalog, "lab_head");
      const ids = result.map((w) => w.id);
      expect(ids).toContain("new-per-surface");
      expect(ids).toContain("legacy-true");
      expect(ids).not.toContain("legacy-false");
    });
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
      // CalendarEventsTodayWidget manager (2026-05-24): the home
      // default's today's-events slot now points at this widget instead
      // of sidebar-todays-announcements.
      id: "calendar-events-today",
      toolId: "calendar",
      variantId: "today",
      title: "Today's events",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 4, h: 6 },
      surfaces: { canvas: true, home: true },
      memberVisible: true,
    },
    {
      // Home widgets surface-prep manager (2026-05-25): the
      // Upcoming-tasks widget is the project-aware half of the new
      // 2-widget home default. Opted into the `home` surface +
      // `labHeadVisible: true` so both account types get it on first
      // load.
      id: "sidebar-upcoming",
      toolId: "daily-tasks",
      variantId: "upcoming",
      title: "Upcoming tasks",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 4, h: 4 },
      surfaces: { sidebar: true, home: true },
      memberVisible: true,
      labHeadVisible: true,
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
    // widget-trim bot (2026-06-02): the member home default is now lean,
    // just the calendar-aware today's-events tile. sidebar-upcoming was
    // dropped because the permanent DailyTasksSidebar already shows
    // upcoming tasks; it stays addable via "+ Add widget".
    expect(layout.widgetOrder.canvas).toEqual(["calendar-events-today"]);
    // Home doesn't use the sidebar axis (today).
    expect(layout.widgetOrder.sidebar).toEqual([]);
  });

  it("seeds new lab_head accounts with the 2 home defaults (lab heads have a customizable rail, not the fixed sidebar)", () => {
    // Lab heads also get the home canvas (they can pin personal widgets
    // there alongside projects). Unlike members they do NOT have the
    // permanent DailyTasksSidebar, so their home default keeps the
    // upcoming-tasks tile alongside today's events.
    const layout = resolveHomeLayout(undefined, "lab_head", homeCatalog);
    expect(layout.widgetOrder.canvas).toEqual([
      "sidebar-upcoming",
      "calendar-events-today",
    ]);
  });

  it("member home default is lean (a single today's-events tile)", () => {
    // widget-trim bot (2026-06-02): members always have the permanent
    // DailyTasksSidebar, so the duplicate sidebar-upcoming home tile was
    // dropped from the member default. It stays in the catalog (addable).
    const def = defaultHomeLayoutFor("member");
    expect(def.widgetOrder.canvas).toEqual(["calendar-events-today"]);
  });

  it("the new default seed only applies to accounts WITHOUT a saved layout", () => {
    // Home widgets surface-prep manager (2026-05-25): the brief
    // requires the new 2-widget seed land in the default-initializer
    // code path, NOT as a migration. Existing users who already have
    // a saved home_layout (the old 4-widget default before the seed
    // shrink, or any custom curation) keep it untouched.
    const oldFourWidgetSaved: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: [
          "announcements",
          "comment-feed",
          "lab-activity",
          "calendar-events-today",
        ],
        sidebar: [],
      },
    };
    const layout = resolveHomeLayout(oldFourWidgetSaved, "member", homeCatalog);
    // The saved 4 widgets survive unchanged; the new 2-widget seed is
    // NOT injected on top.
    expect(layout.widgetOrder.canvas).toEqual([
      "announcements",
      "comment-feed",
      "lab-activity",
      "calendar-events-today",
    ]);
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

/**
 * Per-instance widget config (weekly-goals widget, 2026-05-29):
 * PERSISTED-LAYOUT-SHAPE CHANGE tests. The new optional `widgetConfig`
 * map must:
 *   - migrate idempotently (v2 -> v2 pass-through preserves it),
 *   - survive `resolveLayout` for ids still mounted,
 *   - be pruned for ids no longer in the catalog / order,
 *   - be absent (no key) when there's nothing to carry, so OLD layouts
 *     stay shape-stable and load unchanged.
 */
describe("widgetConfig (per-instance config) — layout-shape change", () => {
  const cfgCatalog: WidgetDefinition[] = [
    {
      id: "trainee-notes",
      toolId: "trainee-notes",
      title: "Trainee notes & goals",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 4, h: 6 },
      surfaces: { canvas: true },
      memberVisible: false,
    },
    {
      id: "announcements",
      toolId: "announcements",
      title: "Announcements",
      SnapshotTile: NullSnapshot,
      SidebarTile: NullSidebar,
      defaultLayout: { w: 12, h: 3 },
      surfaces: { canvas: true },
      memberVisible: true,
    },
  ];

  it("OLD layout without widgetConfig loads unchanged (no key added)", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["announcements"], sidebar: [] },
    };
    const layout = resolveLayout(saved, "lab_head", cfgCatalog);
    expect(layout.widgetConfig).toBeUndefined();
  });

  it("carries a pinnedMember config through migrateLayoutToV2 idempotently", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["trainee-notes"], sidebar: [] },
      widgetConfig: { "trainee-notes": { pinnedMember: "morgan" } },
    };
    const migrated = migrateLayoutToV2(saved);
    expect(migrated?.widgetConfig).toEqual({
      "trainee-notes": { pinnedMember: "morgan" },
    });
  });

  it("resolveLayout preserves config for a mounted widget", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["trainee-notes", "announcements"], sidebar: [] },
      widgetConfig: { "trainee-notes": { pinnedMember: "morgan" } },
    };
    const layout = resolveLayout(saved, "lab_head", cfgCatalog);
    expect(layout.widgetConfig).toEqual({
      "trainee-notes": { pinnedMember: "morgan" },
    });
  });

  it("resolveLayout prunes config for an id that is no longer in the catalog", () => {
    // A widget id that was deleted from the catalog in a prior version is
    // dropped from widgetOrder by the resolver — and its stale config is
    // pruned with it. (Catalog widgets still present are auto-appended by
    // resolveLayout, so their config is never pruned; only genuinely-gone
    // ids lose their config.)
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["deleted-widget-from-prior-version"], sidebar: [] },
      widgetConfig: {
        "deleted-widget-from-prior-version": { pinnedMember: "morgan" },
      },
    };
    const layout = resolveLayout(saved, "lab_head", cfgCatalog);
    expect(
      layout.widgetConfig?.["deleted-widget-from-prior-version"],
    ).toBeUndefined();
  });

  it("resolveLayout drops the widgetConfig key entirely when nothing survives", () => {
    const saved: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["deleted-widget-from-prior-version"], sidebar: [] },
      widgetConfig: {
        "deleted-widget-from-prior-version": { pinnedMember: "morgan" },
      },
    };
    const layout = resolveLayout(saved, "lab_head", cfgCatalog);
    expect(layout.widgetConfig).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Dashboard unification (dashboard-unification build, 2026-05-29)
// ─────────────────────────────────────────────────────────────────────────
//
// The one-time `dashboard_layout` migration: seed from the account-
// appropriate LEGACY field (lab_head ← lab_overview_layout, else ←
// home_layout) and inject Projects Overview at the top if missing. Tests
// both directions so no existing arrangement is dropped.

// Catalog covering both the canvas (PI) surface and the home (member)
// surface, plus the multi-surface Projects Overview widget. Legacy single-
// surface entries can't opt into `home`, so the dashboard-surface entries
// use the `surfaces` map.
const dashboardCatalog: WidgetDefinition[] = [
  {
    id: PROJECTS_OVERVIEW_WIDGET_ID,
    toolId: "projects-overview",
    title: "Projects overview",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 6, h: 6 },
    surfaces: { canvas: true, home: true },
    memberVisible: true,
  },
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
    id: "lab-experiments",
    toolId: "experiments",
    title: "Lab experiments",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 6, h: 6 },
    // Canvas-only (PI dashboard); not home-eligible.
    surfaces: { canvas: true },
    memberVisible: true,
  },
  {
    id: "calendar-events-today",
    toolId: "calendar",
    title: "Today's events",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 4, h: 6 },
    // Home-eligible (member dashboard).
    surfaces: { canvas: true, home: true },
    memberVisible: true,
  },
  {
    // The auto Single Project widget's base catalog entry. Pinned instances
    // carry a `#<owner>:<id>` suffix; eligibility is checked against this
    // base id (dashboard-newproject-tour bot, 2026-05-29).
    id: "single-project",
    toolId: "single-project",
    title: "Single project",
    SnapshotTile: NullSnapshot,
    SidebarTile: NullSidebar,
    defaultLayout: { w: 4, h: 5 },
    surfaces: { canvas: true, home: true },
    memberVisible: true,
  },
];

describe("dashboard surface key", () => {
  it("lab_head reads the canvas surface, member/solo read the home surface", () => {
    expect(dashboardSurfaceFor("lab_head")).toBe("canvas");
    expect(dashboardSurfaceFor("member")).toBe("home");
  });
});

describe("seedDashboardLayout — one-time legacy migration", () => {
  it("seeds a lab_head's dashboard from lab_overview_layout, not home_layout", () => {
    const legacyLabOverview: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["projects-overview", "lab-experiments", "announcements"],
        sidebar: ["sidebar-recent-activity"],
      },
    };
    const legacyHome: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["calendar-events-today"], sidebar: [] },
    };
    const seeded = seedDashboardLayout(
      undefined,
      legacyLabOverview,
      legacyHome,
      "lab_head",
    );
    // Took the lab_overview arrangement verbatim (Projects Overview was
    // already present, so no injection).
    expect(seeded.widgetOrder.canvas).toEqual([
      "projects-overview",
      "lab-experiments",
      "announcements",
    ]);
  });

  it("seeds a member's dashboard from home_layout, not lab_overview_layout", () => {
    const legacyLabOverview: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["lab-experiments"], sidebar: [] },
    };
    const legacyHome: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["projects-overview", "calendar-events-today"],
        sidebar: [],
      },
    };
    const seeded = seedDashboardLayout(
      undefined,
      legacyLabOverview,
      legacyHome,
      "member",
    );
    expect(seeded.widgetOrder.canvas).toEqual([
      "projects-overview",
      "calendar-events-today",
    ]);
    // Did NOT pull from the lab-overview arrangement.
    expect(seeded.widgetOrder.canvas).not.toContain("lab-experiments");
  });

  it("injects Projects Overview at the TOP of an existing layout that lacks it", () => {
    const legacyHome: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["calendar-events-today", "announcements"], sidebar: [] },
    };
    const seeded = seedDashboardLayout(undefined, undefined, legacyHome, "member");
    expect(seeded.widgetOrder.canvas[0]).toBe(PROJECTS_OVERVIEW_WIDGET_ID);
    // Preserves the rest of the user's arrangement after the injected one.
    expect(seeded.widgetOrder.canvas).toEqual([
      "projects-overview",
      "calendar-events-today",
      "announcements",
    ]);
  });

  it("does NOT inject a second Projects Overview when one already exists", () => {
    const legacyLabOverview: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["announcements", "projects-overview"],
        sidebar: [],
      },
    };
    const seeded = seedDashboardLayout(
      undefined,
      legacyLabOverview,
      undefined,
      "lab_head",
    );
    const occurrences = seeded.widgetOrder.canvas.filter(
      (id) => id === PROJECTS_OVERVIEW_WIDGET_ID,
    );
    expect(occurrences).toHaveLength(1);
    // Existing position is preserved (not moved to the top).
    expect(seeded.widgetOrder.canvas).toEqual([
      "announcements",
      "projects-overview",
    ]);
  });

  it("an explicit dashboard_layout wins over the legacy fields", () => {
    const dashboard: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["announcements"], sidebar: [] },
    };
    const legacyHome: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["projects-overview"], sidebar: [] },
    };
    const seeded = seedDashboardLayout(dashboard, undefined, legacyHome, "member");
    expect(seeded.widgetOrder.canvas).toEqual(["announcements"]);
  });

  it("falls back to the account default (WITHOUT Projects Overview) when nothing exists", () => {
    // New-account default-set change (dashboard-newproject-tour bot,
    // 2026-05-29, FLAG): Projects Overview is no longer seeded by default;
    // the top-level New Project button + auto Single Project widgets are the
    // project surface. A brand-new account's default must NOT contain it.
    const seeded = seedDashboardLayout(undefined, undefined, undefined, "member");
    expect(seeded.widgetOrder.canvas).not.toContain(PROJECTS_OVERVIEW_WIDGET_ID);
    expect(defaultDashboardLayoutFor("member").widgetOrder.canvas).not.toContain(
      PROJECTS_OVERVIEW_WIDGET_ID,
    );
    expect(defaultDashboardLayoutFor("lab_head").widgetOrder.canvas).not.toContain(
      PROJECTS_OVERVIEW_WIDGET_ID,
    );
  });

  it("migrates a v1 legacy free-grid into the seeded dashboard", () => {
    const legacyHomeV1: LabOverviewLayoutV1 = {
      version: 1,
      canvas: {
        "calendar-events-today": { x: 0, y: 0, w: 4, h: 4 },
        announcements: { x: 0, y: 1, w: 12, h: 3 },
      },
      sidebar: { order: [], hidden: [] },
    };
    const seeded = seedDashboardLayout(undefined, undefined, legacyHomeV1, "member");
    // v1 → v2 sorts by y ASC: calendar (y0) before announcements (y1),
    // then Projects Overview injected at the top.
    expect(seeded.widgetOrder.canvas).toEqual([
      "projects-overview",
      "calendar-events-today",
      "announcements",
    ]);
  });
});

describe("resolveDashboardLayout — surface-aware normalization", () => {
  it("a lab_head dashboard keeps canvas-only widgets (lab-experiments survives)", () => {
    const legacyLabOverview: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["projects-overview", "lab-experiments", "announcements"],
        sidebar: [],
      },
    };
    const resolved = resolveDashboardLayout(
      undefined,
      legacyLabOverview,
      undefined,
      "lab_head",
      visibleCatalog(dashboardCatalog, "lab_head", "canvas"),
    );
    expect(resolved.widgetOrder.canvas).toContain("lab-experiments");
    expect(resolved.widgetOrder.canvas).toContain("projects-overview");
  });

  it("a member dashboard DROPS canvas-only widgets that aren't home-eligible", () => {
    // A member whose legacy home_layout somehow references a canvas-only
    // widget: it must not surface on the member's (home-surface) dashboard.
    const legacyHome: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["projects-overview", "lab-experiments", "calendar-events-today"],
        sidebar: [],
      },
    };
    const resolved = resolveDashboardLayout(
      undefined,
      undefined,
      legacyHome,
      "member",
      visibleCatalog(dashboardCatalog, "member", "home"),
    );
    // lab-experiments is canvas-only → dropped on the home surface.
    expect(resolved.widgetOrder.canvas).not.toContain("lab-experiments");
    expect(resolved.widgetOrder.canvas).toContain("projects-overview");
    expect(resolved.widgetOrder.canvas).toContain("calendar-events-today");
  });

  it("injects Projects Overview at the top for an existing member layout missing it", () => {
    const legacyHome: LabOverviewLayout = {
      version: 2,
      widgetOrder: { canvas: ["calendar-events-today"], sidebar: [] },
    };
    const resolved = resolveDashboardLayout(
      undefined,
      undefined,
      legacyHome,
      "member",
      visibleCatalog(dashboardCatalog, "member", "home"),
    );
    expect(resolved.widgetOrder.canvas[0]).toBe(PROJECTS_OVERVIEW_WIDGET_ID);
  });

  it("keeps a pinned Single Project widget INSTANCE (instance-id eligibility)", () => {
    // Auto Single Project widget (dashboard-newproject-tour bot, 2026-05-29):
    // pinned instances carry a `#<owner>:<id>` suffix. Eligibility is checked
    // against the BASE `single-project` id, so the instance must survive
    // normalization, AND its widgetConfig pin (keyed by the full instance id)
    // must be preserved.
    const dashboard: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["calendar-events-today", "single-project#mira:7"],
        sidebar: [],
      },
      widgetConfig: {
        "single-project#mira:7": { pinnedProject: { id: 7, owner: "mira" } },
      },
    };
    const resolved = resolveDashboardLayout(
      dashboard,
      undefined,
      undefined,
      "member",
      visibleCatalog(dashboardCatalog, "member", "home"),
    );
    expect(resolved.widgetOrder.canvas).toContain("single-project#mira:7");
    expect(resolved.widgetConfig?.["single-project#mira:7"]).toEqual({
      pinnedProject: { id: 7, owner: "mira" },
    });
  });

  it("drops a pinned instance whose BASE id is not catalog-eligible", () => {
    // Defensive: an instance suffix never smuggles an unknown base widget
    // past the eligibility filter.
    const dashboard: LabOverviewLayout = {
      version: 2,
      widgetOrder: {
        canvas: ["calendar-events-today", "made-up-widget#mira:7"],
        sidebar: [],
      },
    };
    const resolved = resolveDashboardLayout(
      dashboard,
      undefined,
      undefined,
      "member",
      visibleCatalog(dashboardCatalog, "member", "home"),
    );
    expect(resolved.widgetOrder.canvas).not.toContain("made-up-widget#mira:7");
  });
});

describe("new-account default set — Projects Overview OFF by default (FLAG)", () => {
  // New-account default-set change (dashboard-newproject-tour bot,
  // 2026-05-29): the multi-project Projects Overview widget is removed from
  // every account-type default. Existing accounts are untouched (their saved
  // layout / the migration injection above is unchanged).
  it("the member dashboard default omits Projects Overview", () => {
    expect(defaultDashboardLayoutFor("member").widgetOrder.canvas).not.toContain(
      PROJECTS_OVERVIEW_WIDGET_ID,
    );
  });
  it("the lab_head dashboard default omits Projects Overview", () => {
    expect(
      defaultDashboardLayoutFor("lab_head").widgetOrder.canvas,
    ).not.toContain(PROJECTS_OVERVIEW_WIDGET_ID);
  });
  it("the home defaults (legacy seed path) also omit Projects Overview", () => {
    expect(defaultHomeLayoutFor("member").widgetOrder.canvas).not.toContain(
      PROJECTS_OVERVIEW_WIDGET_ID,
    );
    expect(defaultHomeLayoutFor("lab_head").widgetOrder.canvas).not.toContain(
      PROJECTS_OVERVIEW_WIDGET_ID,
    );
  });
});
