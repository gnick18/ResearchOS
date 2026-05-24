/**
 * Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
 * the canonical widget catalog. Adding a new widget = one entry here.
 *
 * The catalog ships every widget for every surface; the visibility
 * filter happens at consumer time via `visibleCatalog(catalog,
 * accountType)`. That keeps the registry's shape orthogonal to who's
 * looking at it.
 *
 * IDs are stable: changing one is a breaking schema change for
 * `_user_settings.json:lab_overview_layout`. If a widget needs to be
 * renamed in copy, leave the id; rename `title` only.
 *
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23): a
 * catalog entry now lists `SnapshotTile` + `ExpandedView` instead of a
 * single `Component`. The snapshot is the small tile rendered on the
 * canvas + sidebar; the expanded view is the rich body that previously
 * mounted directly. The existing widget bodies are preserved
 * unchanged — they're simply re-exposed under the `ExpandedView` name
 * (see each widget file's bottom for the alias). The snapshot tile is
 * a small placeholder built on the shared `<StatTile>` template; Phase
 * B chips replace each per-widget design.
 *
 * Tools refactor — Phase C (Tools refactor manager, 2026-05-23): every
 * entry now carries a `toolId` (the canonical popup it opens, looked
 * up in `lib/lab-overview/tool-registry.ts`) and an optional
 * `variantId` (the tile-shape slug within that Tool). Multiple widget
 * entries can share a `toolId` — those become variants of the same
 * tool (e.g. the three `purchases` variants below). Click any variant
 * → the same Tool popup opens.
 */
import type { WidgetDefinition } from "./types";
import AnnouncementsWidget, {
  SnapshotTile as AnnouncementsSnapshot,
  SidebarTile as AnnouncementsSidebar,
  ExpandedView as AnnouncementsExpanded,
} from "./AnnouncementsWidget";
import CommentFeedWidget, {
  SnapshotTile as CommentFeedSnapshot,
  SidebarTile as CommentFeedSidebar,
  ExpandedView as CommentFeedExpanded,
} from "./CommentFeedWidget";
import MetricsWidget, {
  SnapshotTile as MetricsSnapshot,
  SidebarTile as MetricsSidebar,
  ExpandedView as MetricsExpanded,
} from "./MetricsWidget";
import RecentActivityWidget, {
  SnapshotTile as RecentActivitySnapshot,
  SidebarTile as RecentActivitySidebar,
  ExpandedView as RecentActivityExpanded,
} from "./RecentActivityWidget";
import PiActionsWidget, {
  SnapshotTile as PiActionsSnapshot,
  SidebarTile as PiActionsSidebar,
  ExpandedView as PiActionsExpanded,
} from "./PiActionsWidget";
import MemberWorkloadWidget, {
  SnapshotTile as MemberWorkloadSnapshot,
  SidebarTile as MemberWorkloadSidebar,
  ExpandedView as MemberWorkloadExpanded,
} from "./MemberWorkloadWidget";
import TodaysAnnouncementsWidget, {
  SnapshotTile as TodaysAnnouncementsSnapshot,
  SidebarTile as TodaysAnnouncementsSidebar,
  ExpandedView as TodaysAnnouncementsExpanded,
} from "./TodaysAnnouncementsWidget";
import LabNotesWidget, {
  SnapshotTile as LabNotesSnapshot,
  SidebarTile as LabNotesSidebar,
  ExpandedView as LabNotesExpanded,
} from "./LabNotesWidget";
import LabExperimentsWidget, {
  SnapshotTile as LabExperimentsSnapshot,
  SidebarTile as LabExperimentsSidebar,
  ExpandedView as LabExperimentsExpanded,
} from "./LabExperimentsWidget";
import LabActivityWidget, {
  SnapshotTile as LabActivitySnapshot,
  SidebarTile as LabActivitySidebar,
  ExpandedView as LabActivityExpanded,
} from "./LabActivityWidget";
import LabPurchasesWidget, {
  SnapshotTile as LabPurchasesSnapshot,
  SidebarTile as LabPurchasesSidebar,
  ExpandedView as LabPurchasesExpanded,
} from "./LabPurchasesWidget";
import {
  SnapshotTile as LabPurchasesBurnRateSnapshot,
  SidebarTile as LabPurchasesBurnRateSidebar,
  ExpandedView as LabPurchasesBurnRateExpanded,
} from "./LabPurchasesBurnRateWidget";
import {
  SnapshotTile as LabPurchasesPendingCountSnapshot,
  SidebarTile as LabPurchasesPendingCountSidebar,
  ExpandedView as LabPurchasesPendingCountExpanded,
} from "./LabPurchasesPendingCountWidget";
import {
  OverdueTasksSnapshot,
  TodaysTasksSnapshot,
  UpcomingTasksSnapshot,
  OverdueTasksSidebarTile,
  TodaysTasksSidebarTile,
  UpcomingTasksSidebarTile,
  OverdueTasksExpanded,
  TodaysTasksExpanded,
  UpcomingTasksExpanded,
} from "./TaskListWidgets";
import {
  SnapshotTile as DailyTasksSnapshot,
  SidebarTile as DailyTasksSidebarTile,
  ExpandedView as DailyTasksExpanded,
} from "./DailyTasksWidget";

// Touch the default exports so TypeScript doesn't flag them as unused
// imports — we intentionally import them for symmetry / side-effect
// (the widget body module is loaded eagerly so its hooks register the
// query keys in React Query's cache map). Cheaper than splitting the
// imports across "type only" + "value" lines.
void AnnouncementsWidget;
void CommentFeedWidget;
void MetricsWidget;
void RecentActivityWidget;
void PiActionsWidget;
void MemberWorkloadWidget;
void TodaysAnnouncementsWidget;
void LabNotesWidget;
void LabExperimentsWidget;
void LabActivityWidget;
void LabPurchasesWidget;

export const WIDGET_CATALOG: WidgetDefinition[] = [
  // ── Canvas widgets ───────────────────────────────────────────────────
  {
    id: "announcements",
    toolId: "announcements",
    title: "Announcements",
    description: "Lab-wide updates. PI composer + pinned posts.",
    SnapshotTile: AnnouncementsSnapshot,
    SidebarTile: AnnouncementsSidebar,
    ExpandedView: AnnouncementsExpanded,
    defaultLayout: { w: 12, h: 3, minW: 4, minH: 2 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "comment-feed",
    toolId: "comments",
    title: "Lab comments",
    description: "Every comment thread across the lab, newest first.",
    SnapshotTile: CommentFeedSnapshot,
    SidebarTile: CommentFeedSidebar,
    ExpandedView: CommentFeedExpanded,
    defaultLayout: { w: 8, h: 6, minW: 4, minH: 3 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "metrics",
    toolId: "metrics",
    title: "Lab metrics",
    description: "Cross-lab Gantt overlay + funding + roadmap rollup.",
    SnapshotTile: MetricsSnapshot,
    SidebarTile: MetricsSidebar,
    ExpandedView: MetricsExpanded,
    defaultLayout: { w: 4, h: 6, minW: 4, minH: 4 },
    surface: "canvas",
    memberVisible: false, // lab_head only
  },

  // R3 catalog additions (R3 widget catalog manager, 2026-05-23):
  // canvas-surface ports of the Lab Mode panels.
  {
    id: "lab-notes",
    toolId: "notes",
    title: "Lab notes",
    description:
      "Cross-lab notes the viewer can read (canRead filter), searchable + filterable.",
    SnapshotTile: LabNotesSnapshot,
    SidebarTile: LabNotesSidebar,
    ExpandedView: LabNotesExpanded,
    defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "lab-experiments",
    toolId: "experiments",
    title: "Lab experiments",
    description: "Outcome gallery of every lab member's experiments.",
    SnapshotTile: LabExperimentsSnapshot,
    SidebarTile: LabExperimentsSidebar,
    ExpandedView: LabExperimentsExpanded,
    defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 },
    surface: "canvas",
    memberVisible: true,
  },
  // Widget catalog cleanup (widget catalog cleanup manager, 2026-05-23):
  // Lab Links + Lab Search dropped. Both surfaces already exist as
  // top-nav tabs (/links + the global search affordances), so the
  // widget variants were redundant. Replaced by the two entries below.
  {
    id: "lab-activity",
    toolId: "lab-activity",
    title: "Lab activity",
    description:
      "Deep, paginated activity feed across the lab (comments, tasks, flags, announcements).",
    SnapshotTile: LabActivitySnapshot,
    SidebarTile: LabActivitySidebar,
    ExpandedView: LabActivityExpanded,
    defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
    surface: "canvas",
    // Members can see the same activity buckets the sidebar
    // RecentActivityWidget already surfaces (no PI-only fields). If a
    // later refinement adds purchase approvals or audit entries here
    // this should flip to false.
    memberVisible: true,
  },

  // ── Purchases tool: 3 widget variants (Phase C, Tools refactor) ──────
  // Three tile shapes, one popup. The user can pin any combination on
  // the canvas. The Tools launcher always shows ONE Purchases entry
  // (the launcher iterates Tools, not Widgets).

  {
    // Variant 1: the existing funding-bars tile (kept under the original
    // `lab-purchases` id so saved layouts continue to render).
    id: "lab-purchases",
    toolId: "purchases",
    variantId: "funding-bars",
    title: "Lab purchases",
    description:
      "Pending approvals, recent purchases, and funding rollup. Lab head only.",
    SnapshotTile: LabPurchasesSnapshot,
    SidebarTile: LabPurchasesSidebar,
    ExpandedView: LabPurchasesExpanded,
    defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
    surface: "canvas",
    memberVisible: false, // lab_head only; replaces the /purchases nav for PIs
  },
  {
    // Variant 2: the burn-rate 4-week chart. New in Phase C. Canvas-only.
    // Opens the same LabPurchases 4-tab popup as the funding-bars variant.
    id: "lab-purchases-burn-rate",
    toolId: "purchases",
    variantId: "burn-rate",
    title: "Purchase burn rate",
    description:
      "Approved purchase spend over the last 4 weeks. Lab head only.",
    SnapshotTile: LabPurchasesBurnRateSnapshot,
    SidebarTile: LabPurchasesBurnRateSidebar,
    ExpandedView: LabPurchasesBurnRateExpanded,
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 4 },
    surface: "canvas",
    memberVisible: false,
  },
  {
    // Variant 3: the compact pending-count summary. New in Phase C.
    // Canvas-only. Same popup.
    id: "lab-purchases-pending-count",
    toolId: "purchases",
    variantId: "pending-count",
    title: "Pending purchase approvals",
    description:
      "Count + total dollar value of unapproved purchases. Lab head only.",
    SnapshotTile: LabPurchasesPendingCountSnapshot,
    SidebarTile: LabPurchasesPendingCountSidebar,
    ExpandedView: LabPurchasesPendingCountExpanded,
    defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 },
    surface: "canvas",
    memberVisible: false,
  },

  // ── Sidebar widgets (PI-oriented) ────────────────────────────────────
  {
    id: "sidebar-recent-activity",
    toolId: "recent-activity",
    title: "Recent lab activity",
    description: "Newest comments, shares, and task creations across the lab.",
    SnapshotTile: RecentActivitySnapshot,
    SidebarTile: RecentActivitySidebar,
    ExpandedView: RecentActivityExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-pi-actions",
    toolId: "pi-actions",
    title: "Pending lab head actions",
    description: "Purchase approvals + flag queue counts (R3).",
    SnapshotTile: PiActionsSnapshot,
    SidebarTile: PiActionsSidebar,
    ExpandedView: PiActionsExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: false, // PI-only signal
  },
  {
    id: "sidebar-member-workload",
    toolId: "member-workload",
    title: "Member workload",
    description: "Open + overdue counts per lab member.",
    SnapshotTile: MemberWorkloadSnapshot,
    SidebarTile: MemberWorkloadSidebar,
    ExpandedView: MemberWorkloadExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: false,
  },
  {
    id: "sidebar-todays-announcements",
    toolId: "todays-announcements",
    title: "Today's announcements",
    description: "Pinned announcements, titles only.",
    SnapshotTile: TodaysAnnouncementsSnapshot,
    SidebarTile: TodaysAnnouncementsSidebar,
    ExpandedView: TodaysAnnouncementsExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },

  // ── Sidebar widgets (task-centric, the existing sidebar surface) ─────
  // PI carve-out (Grant 2026-05-23): these three task-list sidebar widgets
  // show the viewer's PERSONAL overdue/today/upcoming task counts, which
  // is fine for members. On a PI's sidebar though they read as a
  // "what does the lab still have open" prompt that nudges
  // micromanagement, even though the counts are personal. PIs get the
  // same signals via DailyTasksWidget if they want them. Hide from the
  // lab_head catalog + filter out of any lab_head saved layout.
  //
  // All three task widgets point at the `daily-tasks` Tool — that Tool's
  // popup is the DailyTasksWidget body, which already shows
  // overdue/today/upcoming buckets together. Three sidebar tiles, one
  // popup.
  {
    id: "sidebar-overdue",
    toolId: "daily-tasks",
    variantId: "overdue",
    title: "Overdue tasks",
    description: "Your past-due open tasks.",
    SnapshotTile: OverdueTasksSnapshot,
    SidebarTile: OverdueTasksSidebarTile,
    ExpandedView: OverdueTasksExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
    labHeadVisible: false,
  },
  {
    id: "sidebar-today",
    toolId: "daily-tasks",
    variantId: "today",
    title: "Today's tasks",
    description: "Tasks scheduled to land today.",
    SnapshotTile: TodaysTasksSnapshot,
    SidebarTile: TodaysTasksSidebarTile,
    ExpandedView: TodaysTasksExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
    labHeadVisible: false,
  },
  {
    id: "sidebar-upcoming",
    toolId: "daily-tasks",
    variantId: "upcoming",
    title: "Upcoming tasks",
    description: "Tasks starting after today.",
    SnapshotTile: UpcomingTasksSnapshot,
    SidebarTile: UpcomingTasksSidebarTile,
    ExpandedView: UpcomingTasksExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
    labHeadVisible: false,
  },

  // ── Customizable-sidebar additions ───────────────────────────────────
  // Customizable PI sidebar (#146 customizable PI sidebar manager,
  // 2026-05-23): the existing `<DailyTasksSidebar>` packaged as a
  // pinnable widget so lab heads can keep their daily tasks in the
  // customizable rail. ExpandedView mounts the full sidebar body
  // inside the popup. memberVisible: true because the catalog stays
  // role-orthogonal (members just won't see the customizable rail,
  // they keep using `<DailyTasksSidebar>` directly via AppShell).
  {
    id: "sidebar-daily-tasks",
    toolId: "daily-tasks",
    variantId: "full-stack",
    title: "Daily tasks",
    description:
      "The standard daily-tasks sidebar (overdue, today, upcoming, per-project grouping). The default member sidebar, also pinnable by lab heads.",
    SnapshotTile: DailyTasksSnapshot,
    SidebarTile: DailyTasksSidebarTile,
    ExpandedView: DailyTasksExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
];

/** Look up a widget definition by id. Returns undefined for unknown ids. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id);
}
