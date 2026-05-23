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
 */
import type { WidgetDefinition } from "./types";
import AnnouncementsWidget, {
  SnapshotTile as AnnouncementsSnapshot,
  ExpandedView as AnnouncementsExpanded,
} from "./AnnouncementsWidget";
import CommentFeedWidget, {
  SnapshotTile as CommentFeedSnapshot,
  ExpandedView as CommentFeedExpanded,
} from "./CommentFeedWidget";
import MetricsWidget, {
  SnapshotTile as MetricsSnapshot,
  ExpandedView as MetricsExpanded,
} from "./MetricsWidget";
import RecentActivityWidget, {
  SnapshotTile as RecentActivitySnapshot,
  ExpandedView as RecentActivityExpanded,
} from "./RecentActivityWidget";
import PiActionsWidget, {
  SnapshotTile as PiActionsSnapshot,
  ExpandedView as PiActionsExpanded,
} from "./PiActionsWidget";
import MemberWorkloadWidget, {
  SnapshotTile as MemberWorkloadSnapshot,
  ExpandedView as MemberWorkloadExpanded,
} from "./MemberWorkloadWidget";
import TodaysAnnouncementsWidget, {
  SnapshotTile as TodaysAnnouncementsSnapshot,
  ExpandedView as TodaysAnnouncementsExpanded,
} from "./TodaysAnnouncementsWidget";
import LabNotesWidget, {
  SnapshotTile as LabNotesSnapshot,
  ExpandedView as LabNotesExpanded,
} from "./LabNotesWidget";
import LabExperimentsWidget, {
  SnapshotTile as LabExperimentsSnapshot,
  ExpandedView as LabExperimentsExpanded,
} from "./LabExperimentsWidget";
import LabActivityWidget, {
  SnapshotTile as LabActivitySnapshot,
  ExpandedView as LabActivityExpanded,
} from "./LabActivityWidget";
import LabPurchasesWidget, {
  SnapshotTile as LabPurchasesSnapshot,
  ExpandedView as LabPurchasesExpanded,
} from "./LabPurchasesWidget";
import {
  OverdueTasksSnapshot,
  TodaysTasksSnapshot,
  UpcomingTasksSnapshot,
  OverdueTasksExpanded,
  TodaysTasksExpanded,
  UpcomingTasksExpanded,
} from "./TaskListWidgets";

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
    title: "Announcements",
    description: "Lab-wide updates. PI composer + pinned posts.",
    SnapshotTile: AnnouncementsSnapshot,
    ExpandedView: AnnouncementsExpanded,
    defaultLayout: { w: 12, h: 3, minW: 4, minH: 2 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "comment-feed",
    title: "Lab comments",
    description: "Every comment thread across the lab, newest first.",
    SnapshotTile: CommentFeedSnapshot,
    ExpandedView: CommentFeedExpanded,
    defaultLayout: { w: 8, h: 6, minW: 4, minH: 3 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "metrics",
    title: "Lab metrics",
    description: "Cross-lab Gantt overlay + funding + roadmap rollup.",
    SnapshotTile: MetricsSnapshot,
    ExpandedView: MetricsExpanded,
    defaultLayout: { w: 4, h: 6, minW: 4, minH: 4 },
    surface: "canvas",
    memberVisible: false, // lab_head only
  },

  // R3 catalog additions (R3 widget catalog manager, 2026-05-23):
  // canvas-surface ports of the Lab Mode panels.
  {
    id: "lab-notes",
    title: "Lab notes",
    description:
      "Cross-lab notes the viewer can read (canRead filter), searchable + filterable.",
    SnapshotTile: LabNotesSnapshot,
    ExpandedView: LabNotesExpanded,
    defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "lab-experiments",
    title: "Lab experiments",
    description: "Outcome gallery of every lab member's experiments.",
    SnapshotTile: LabExperimentsSnapshot,
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
    title: "Lab activity",
    description:
      "Deep, paginated activity feed across the lab (comments, tasks, flags, announcements).",
    SnapshotTile: LabActivitySnapshot,
    ExpandedView: LabActivityExpanded,
    defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
    surface: "canvas",
    // Members can see the same activity buckets the sidebar
    // RecentActivityWidget already surfaces (no PI-only fields). If a
    // later refinement adds purchase approvals or audit entries here
    // this should flip to false.
    memberVisible: true,
  },
  {
    id: "lab-purchases",
    title: "Lab purchases",
    description:
      "Pending approvals, recent purchases, and funding rollup. Lab head only.",
    SnapshotTile: LabPurchasesSnapshot,
    ExpandedView: LabPurchasesExpanded,
    defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
    surface: "canvas",
    memberVisible: false, // lab_head only; replaces the /purchases nav for PIs
  },

  // ── Sidebar widgets (PI-oriented) ────────────────────────────────────
  {
    id: "sidebar-recent-activity",
    title: "Recent lab activity",
    description: "Newest comments, shares, and task creations across the lab.",
    SnapshotTile: RecentActivitySnapshot,
    ExpandedView: RecentActivityExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-pi-actions",
    title: "Pending lab head actions",
    description: "Purchase approvals + flag queue counts (R3).",
    SnapshotTile: PiActionsSnapshot,
    ExpandedView: PiActionsExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: false, // PI-only signal
  },
  {
    id: "sidebar-member-workload",
    title: "Member workload",
    description: "Open + overdue counts per lab member.",
    SnapshotTile: MemberWorkloadSnapshot,
    ExpandedView: MemberWorkloadExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: false,
  },
  {
    id: "sidebar-todays-announcements",
    title: "Today's announcements",
    description: "Pinned announcements, titles only.",
    SnapshotTile: TodaysAnnouncementsSnapshot,
    ExpandedView: TodaysAnnouncementsExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },

  // ── Sidebar widgets (task-centric, the existing sidebar surface) ─────
  {
    id: "sidebar-overdue",
    title: "Overdue tasks",
    description: "Your past-due open tasks.",
    SnapshotTile: OverdueTasksSnapshot,
    ExpandedView: OverdueTasksExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-today",
    title: "Today's tasks",
    description: "Tasks scheduled to land today.",
    SnapshotTile: TodaysTasksSnapshot,
    ExpandedView: TodaysTasksExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-upcoming",
    title: "Upcoming tasks",
    description: "Tasks starting after today.",
    SnapshotTile: UpcomingTasksSnapshot,
    ExpandedView: UpcomingTasksExpanded,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
];

/** Look up a widget definition by id. Returns undefined for unknown ids. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id);
}
