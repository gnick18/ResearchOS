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
 */
import type { WidgetDefinition } from "./types";
import AnnouncementsWidget from "./AnnouncementsWidget";
import CommentFeedWidget from "./CommentFeedWidget";
import MetricsWidget from "./MetricsWidget";
import RecentActivityWidget from "./RecentActivityWidget";
import PiActionsWidget from "./PiActionsWidget";
import MemberWorkloadWidget from "./MemberWorkloadWidget";
import TodaysAnnouncementsWidget from "./TodaysAnnouncementsWidget";
import {
  OverdueTasksWidget,
  TodaysTasksWidget,
  UpcomingTasksWidget,
} from "./TaskListWidgets";

export const WIDGET_CATALOG: WidgetDefinition[] = [
  // ── Canvas widgets ───────────────────────────────────────────────────
  {
    id: "announcements",
    title: "Announcements",
    description: "Lab-wide updates. PI composer + pinned posts.",
    Component: AnnouncementsWidget,
    defaultLayout: { w: 12, h: 3, minW: 4, minH: 2 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "comment-feed",
    title: "Lab comments",
    description: "Every comment thread across the lab, newest first.",
    Component: CommentFeedWidget,
    defaultLayout: { w: 8, h: 6, minW: 4, minH: 3 },
    surface: "canvas",
    memberVisible: true,
  },
  {
    id: "metrics",
    title: "Lab metrics",
    description: "Cross-lab Gantt overlay + funding + roadmap rollup.",
    Component: MetricsWidget,
    defaultLayout: { w: 4, h: 6, minW: 4, minH: 4 },
    surface: "canvas",
    memberVisible: false, // lab_head only
  },

  // ── Sidebar widgets (PI-oriented) ────────────────────────────────────
  {
    id: "sidebar-recent-activity",
    title: "Recent lab activity",
    description: "Newest comments, shares, and task creations across the lab.",
    Component: RecentActivityWidget,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true, // ordinary members benefit too if they enable it
  },
  {
    id: "sidebar-pi-actions",
    title: "Pending lab head actions",
    description: "Purchase approvals + flag queue + audit acks awaiting you.",
    Component: PiActionsWidget,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: false, // PI-only signal
  },
  {
    id: "sidebar-member-workload",
    title: "Member workload",
    description: "Open + overdue counts per lab member.",
    Component: MemberWorkloadWidget,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: false,
  },
  {
    id: "sidebar-todays-announcements",
    title: "Today's announcements",
    description: "Pinned announcements, titles only.",
    Component: TodaysAnnouncementsWidget,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },

  // ── Sidebar widgets (task-centric, the existing sidebar surface) ─────
  {
    id: "sidebar-overdue",
    title: "Overdue tasks",
    description: "Your past-due open tasks.",
    Component: OverdueTasksWidget,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-today",
    title: "Today's tasks",
    description: "Tasks scheduled to land today.",
    Component: TodaysTasksWidget,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
  {
    id: "sidebar-upcoming",
    title: "Upcoming tasks",
    description: "Tasks starting after today.",
    Component: UpcomingTasksWidget,
    defaultLayout: { w: 1, h: 1 },
    surface: "sidebar",
    memberVisible: true,
  },
];

/** Look up a widget definition by id. Returns undefined for unknown ids. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id);
}
