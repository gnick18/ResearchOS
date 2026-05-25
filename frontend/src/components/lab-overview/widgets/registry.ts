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
 * catalog entry now lists `SnapshotTile` + a sidebar variant instead of
 * a single `Component`. The snapshot is the small tile rendered on the
 * canvas + sidebar; the rich body that previously mounted directly is
 * now the Tool popup. The existing widget bodies are preserved
 * unchanged, re-exposed as `ExpandedView` named exports for the Tool
 * registry to import (see each widget file's bottom for the alias).
 *
 * Tools refactor, Phase C (Tools refactor manager, 2026-05-23): every
 * entry now carries a `toolId` (the canonical popup it opens, looked
 * up in `lib/lab-overview/tool-registry.tsx`) and an optional
 * `variantId` (the tile-shape slug within that Tool). Multiple widget
 * entries can share a `toolId`, those become variants of the same
 * tool (e.g. the three `purchases` variants below). Click any variant,
 * the same Tool popup opens.
 *
 * Back-compat removal (Back-compat removal manager, 2026-05-23): the
 * defensive per-widget `ExpandedView` routing field has been dropped.
 * The Tool registry is now the single source of truth for popup bodies.
 * A widget whose `toolId` doesn't resolve renders a diagnostic
 * placeholder via `resolveExpandedView` (registry-shape bug).
 */
import type { WidgetDefinition } from "./types";
import AnnouncementsWidget, {
  SnapshotTile as AnnouncementsSnapshot,
  SidebarTile as AnnouncementsSidebar,
  HELP_TEXT as AnnouncementsHelp,
} from "./AnnouncementsWidget";
import CommentFeedWidget, {
  SnapshotTile as CommentFeedSnapshot,
  SidebarTile as CommentFeedSidebar,
  HELP_TEXT as CommentFeedHelp,
} from "./CommentFeedWidget";
import MetricsWidget, {
  SnapshotTile as MetricsSnapshot,
  SidebarTile as MetricsSidebar,
  HELP_TEXT as MetricsHelp,
} from "./MetricsWidget";
import RecentActivityWidget, {
  SnapshotTile as RecentActivitySnapshot,
  SidebarTile as RecentActivitySidebar,
  HELP_TEXT as RecentActivityHelp,
} from "./RecentActivityWidget";
import PiActionsWidget, {
  SnapshotTile as PiActionsSnapshot,
  SidebarTile as PiActionsSidebar,
  HELP_TEXT as PiActionsHelp,
} from "./PiActionsWidget";
import MemberWorkloadWidget, {
  SnapshotTile as MemberWorkloadSnapshot,
  SidebarTile as MemberWorkloadSidebar,
  HELP_TEXT as MemberWorkloadHelp,
} from "./MemberWorkloadWidget";
import TodaysAnnouncementsWidget, {
  SnapshotTile as TodaysAnnouncementsSnapshot,
  SidebarTile as TodaysAnnouncementsSidebar,
  HELP_TEXT as TodaysAnnouncementsHelp,
} from "./TodaysAnnouncementsWidget";
import LabNotesWidget, {
  SnapshotTile as LabNotesSnapshot,
  SidebarTile as LabNotesSidebar,
  HELP_TEXT as LabNotesHelp,
} from "./LabNotesWidget";
import LabExperimentsWidget, {
  SnapshotTile as LabExperimentsSnapshot,
  SidebarTile as LabExperimentsSidebar,
  HELP_TEXT as LabExperimentsHelp,
} from "./LabExperimentsWidget";
import LabActivityWidget, {
  SnapshotTile as LabActivitySnapshot,
  SidebarTile as LabActivitySidebar,
  HELP_TEXT as LabActivityHelp,
} from "./LabActivityWidget";
import LabPurchasesWidget, {
  SnapshotTile as LabPurchasesSnapshot,
  SidebarTile as LabPurchasesSidebar,
  HELP_TEXT as LabPurchasesHelp,
} from "./LabPurchasesWidget";
import {
  SnapshotTile as LabPurchasesBurnRateSnapshot,
  SidebarTile as LabPurchasesBurnRateSidebar,
  HELP_TEXT as LabPurchasesBurnRateHelp,
} from "./LabPurchasesBurnRateWidget";
import {
  SnapshotTile as LabPurchasesPendingCountSnapshot,
  SidebarTile as LabPurchasesPendingCountSidebar,
  HELP_TEXT as LabPurchasesPendingCountHelp,
} from "./LabPurchasesPendingCountWidget";
// Tool variants batch (Tool variants batch manager, 2026-05-24): three
// new tile-shape variants of existing Tools. Each variant shares its
// Tool's ExpandedView via toolId; no new popups.
import {
  SnapshotTile as CommentMentionsSnapshot,
  SidebarTile as CommentMentionsSidebar,
  HELP_TEXT as CommentMentionsHelp,
} from "./CommentMentionsWidget";
import {
  SnapshotTile as ExperimentsReadySnapshot,
  SidebarTile as ExperimentsReadySidebar,
  HELP_TEXT as ExperimentsReadyHelp,
} from "./ExperimentsReadyWidget";
import {
  SnapshotTile as LabActivityByTypeSnapshot,
  SidebarTile as LabActivityByTypeSidebar,
  HELP_TEXT as LabActivityByTypeHelp,
} from "./LabActivityByTypeWidget";
import {
  OverdueTasksSnapshot,
  TodaysTasksSnapshot,
  UpcomingTasksSnapshot,
  OverdueTasksSidebarTile,
  TodaysTasksSidebarTile,
  UpcomingTasksSidebarTile,
} from "./TaskListWidgets";
import {
  SnapshotTile as DailyTasksSnapshot,
  SidebarTile as DailyTasksSidebarTile,
} from "./DailyTasksWidget";
import CalendarEventsTodayWidget, {
  SnapshotTile as CalendarEventsTodaySnapshot,
  SidebarTile as CalendarEventsTodaySidebar,
  HELP_TEXT as CalendarEventsTodayHelp,
} from "./CalendarEventsTodayWidget";

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
void CalendarEventsTodayWidget;

export const WIDGET_CATALOG: WidgetDefinition[] = [
  // ── Canvas widgets ───────────────────────────────────────────────────
  {
    id: "announcements",
    toolId: "announcements",
    title: "Announcements",
    description: "Lab-wide updates. PI composer + pinned posts.",
    helpText: AnnouncementsHelp,
    SnapshotTile: AnnouncementsSnapshot,
    SidebarTile: AnnouncementsSidebar,
    defaultLayout: { w: 12, h: 3, minW: 4, minH: 2 },
    // Home canvas migration (2026-05-23): Announcements is one of the
    // four signals Grant called out for /home ("im really just not
    // convinced the lab overview page is necessary for non lab heads.
    // Like i do see a utility to showing the announcements or comments
    // on their work by others"). Both canvas + home.
    surfaces: { canvas: true, home: true },
    memberVisible: true,
  },
  {
    id: "comment-feed",
    toolId: "comments",
    title: "Lab comments",
    description: "Every comment thread across the lab, newest first.",
    helpText: CommentFeedHelp,
    SnapshotTile: CommentFeedSnapshot,
    SidebarTile: CommentFeedSidebar,
    defaultLayout: { w: 8, h: 6, minW: 4, minH: 3 },
    // Home canvas migration (2026-05-23): comments-on-my-work is the
    // second Grant-called-out home signal.
    surfaces: { canvas: true, home: true },
    memberVisible: true,
  },
  // Tool variants batch (Tool variants batch manager, 2026-05-24):
  // @-mentions tile-variant of the Comments Tool. Same toolId =>
  // clicking opens the canonical Comments popup.
  {
    id: "comment-mentions",
    toolId: "comments",
    variantId: "mentions",
    title: "@-mentions",
    description: "Comments that @-mention you, across the lab.",
    helpText: CommentMentionsHelp,
    SnapshotTile: CommentMentionsSnapshot,
    SidebarTile: CommentMentionsSidebar,
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 },
    // Member-relevant (their own pings) + PI-relevant (their own pings
    // too). Opt-in via the Add widget palette on both /lab-overview and
    // /home — not auto-added to either default layout.
    surfaces: { canvas: true, home: true },
    memberVisible: true,
  },
  {
    id: "metrics",
    toolId: "metrics",
    title: "Lab metrics",
    description: "Cross-lab Gantt overlay + funding + roadmap rollup.",
    helpText: MetricsHelp,
    SnapshotTile: MetricsSnapshot,
    SidebarTile: MetricsSidebar,
    defaultLayout: { w: 4, h: 6, minW: 4, minH: 4 },
    // PI-only dashboard signal — stays on /lab-overview; not opted
    // into /home. Lab heads can manually pin it on Home if they want,
    // but the default home stays focused on lab signals members care
    // about.
    surfaces: { canvas: true },
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
    helpText: LabNotesHelp,
    SnapshotTile: LabNotesSnapshot,
    SidebarTile: LabNotesSidebar,
    defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 },
    // Stays lab-overview-only by default (members can still pin it
    // via the Home palette if they want, but it's not one of Grant's
    // called-out home defaults).
    surfaces: { canvas: true },
    memberVisible: true,
  },
  {
    id: "lab-experiments",
    toolId: "experiments",
    title: "Lab experiments",
    description: "Outcome gallery of every lab member's experiments.",
    helpText: LabExperimentsHelp,
    SnapshotTile: LabExperimentsSnapshot,
    SidebarTile: LabExperimentsSidebar,
    defaultLayout: { w: 6, h: 6, minW: 4, minH: 4 },
    surfaces: { canvas: true },
    memberVisible: true,
  },
  // Tool variants batch (Tool variants batch manager, 2026-05-24):
  // ready-writeup tile-variant of the Experiments Tool. Same toolId =>
  // clicking opens the canonical Experiments popup.
  {
    id: "experiments-ready-writeup",
    toolId: "experiments",
    variantId: "ready-writeup",
    title: "Ready to write up",
    description:
      "Completed experiments that don't have a writeup attached yet.",
    helpText: ExperimentsReadyHelp,
    SnapshotTile: ExperimentsReadySnapshot,
    SidebarTile: ExperimentsReadySidebar,
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 },
    surfaces: { canvas: true, home: true },
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
    helpText: LabActivityHelp,
    SnapshotTile: LabActivitySnapshot,
    SidebarTile: LabActivitySidebar,
    defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
    // Home canvas migration (2026-05-23): lab activity is the third
    // Grant-called-out home signal ("announcements + comments-on-my-
    // work + lab activity + today's events").
    surfaces: { canvas: true, home: true },
    // Members can see the same activity buckets the sidebar
    // RecentActivityWidget already surfaces (no PI-only fields). If a
    // later refinement adds purchase approvals or audit entries here
    // this should flip to false.
    memberVisible: true,
  },
  // Tool variants batch (Tool variants batch manager, 2026-05-24):
  // by-type tile-variant of the Lab Activity Tool. Three small columns
  // (tasks / notes / purchases) for today's activity. Same toolId =>
  // clicking opens the canonical Lab Activity popup.
  {
    id: "lab-activity-by-type",
    toolId: "lab-activity",
    variantId: "by-type",
    title: "Activity by area",
    description: "Today's activity split into tasks, notes, and purchases.",
    helpText: LabActivityByTypeHelp,
    SnapshotTile: LabActivityByTypeSnapshot,
    SidebarTile: LabActivityByTypeSidebar,
    defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
    surfaces: { canvas: true, home: true },
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
    helpText: LabPurchasesHelp,
    SnapshotTile: LabPurchasesSnapshot,
    SidebarTile: LabPurchasesSidebar,
    defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 },
    // PI-only dashboard signal — stays on /lab-overview.
    surfaces: { canvas: true },
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
    helpText: LabPurchasesBurnRateHelp,
    SnapshotTile: LabPurchasesBurnRateSnapshot,
    SidebarTile: LabPurchasesBurnRateSidebar,
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 4 },
    surfaces: { canvas: true },
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
    helpText: LabPurchasesPendingCountHelp,
    SnapshotTile: LabPurchasesPendingCountSnapshot,
    SidebarTile: LabPurchasesPendingCountSidebar,
    defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 },
    surfaces: { canvas: true },
    memberVisible: false,
  },

  // ── Sidebar widgets (PI-oriented) ────────────────────────────────────
  {
    id: "sidebar-recent-activity",
    toolId: "recent-activity",
    title: "Recent lab activity",
    description: "Newest comments, shares, and task creations across the lab.",
    helpText: RecentActivityHelp,
    SnapshotTile: RecentActivitySnapshot,
    SidebarTile: RecentActivitySidebar,
    defaultLayout: { w: 1, h: 1 },
    surfaces: { sidebar: true },
    memberVisible: true,
  },
  {
    id: "sidebar-pi-actions",
    toolId: "pi-actions",
    title: "Pending lab head actions",
    description: "Purchase approvals + flag queue counts (R3).",
    helpText: PiActionsHelp,
    SnapshotTile: PiActionsSnapshot,
    SidebarTile: PiActionsSidebar,
    defaultLayout: { w: 1, h: 1 },
    surfaces: { sidebar: true },
    memberVisible: false, // PI-only signal
  },
  {
    id: "sidebar-member-workload",
    toolId: "member-workload",
    title: "Member workload",
    description: "Open + overdue counts per lab member.",
    helpText: MemberWorkloadHelp,
    SnapshotTile: MemberWorkloadSnapshot,
    SidebarTile: MemberWorkloadSidebar,
    defaultLayout: { w: 1, h: 1 },
    surfaces: { sidebar: true },
    memberVisible: false,
  },
  {
    id: "sidebar-todays-announcements",
    toolId: "todays-announcements",
    title: "Today's announcements",
    description: "Pinned announcements, titles only.",
    helpText: TodaysAnnouncementsHelp,
    SnapshotTile: TodaysAnnouncementsSnapshot,
    SidebarTile: TodaysAnnouncementsSidebar,
    defaultLayout: { w: 1, h: 1 },
    // Home canvas migration (2026-05-23): originally chosen as the
    // home "today's events" slot because no dedicated calendar-events-
    // today widget existed. CalendarEventsTodayWidget (added 2026-05-24)
    // is now the canonical today's-events tile and the default home
    // layout points at it instead. This widget stays in the catalog so
    // members and lab heads can still opt to pin it via Add widget on
    // either home or sidebar.
    surfaces: { sidebar: true, canvas: true, home: true },
    memberVisible: true,
  },
  // CalendarEventsTodayWidget (CalendarEventsTodayWidget manager,
  // 2026-05-24): the true "today's events" tile, replacing the
  // TodaysAnnouncementsWidget stand-in in the default home layout.
  // Sits next to its today-themed sibling in the catalog so both read
  // as related variants. Canvas-eligible too so a lab head can pin it
  // on /lab-overview if they want a today's-events tile on the dense
  // PI dashboard. toolId is the new `calendar` Tool registered in
  // `lib/lab-overview/tool-registry.tsx`.
  {
    id: "calendar-events-today",
    toolId: "calendar",
    variantId: "today",
    title: "Today's events",
    // The Calendar Tool's umbrella title is "Calendar" (it can hold
    // future variants for week / month views). This tile is the today
    // variant, so the popup header should match what the user clicked.
    // widget popup-title manager (2026-05-25).
    popupTitle: "Today's events",
    description:
      "Calendar events scheduled for today, across all your subscribed feeds.",
    helpText: CalendarEventsTodayHelp,
    SnapshotTile: CalendarEventsTodaySnapshot,
    SidebarTile: CalendarEventsTodaySidebar,
    defaultLayout: { w: 4, h: 6, minW: 3, minH: 3 },
    surfaces: { canvas: true, home: true },
    memberVisible: true,
    labHeadVisible: true,
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
    // daily-tasks Tool covers Overdue / Today / Upcoming as one popup
    // body, but its umbrella title is "Today's tasks". Without an
    // override, clicking the Overdue tile opens a popup labelled
    // "Today's tasks" which breaks the "click the tile to expand it"
    // mental model. widget popup-title manager (2026-05-25).
    popupTitle: "Overdue tasks",
    description: "Your past-due open tasks.",
    SnapshotTile: OverdueTasksSnapshot,
    SidebarTile: OverdueTasksSidebarTile,
    defaultLayout: { w: 1, h: 1 },
    surfaces: { sidebar: true },
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
    defaultLayout: { w: 1, h: 1 },
    surfaces: { sidebar: true },
    memberVisible: true,
    labHeadVisible: false,
  },
  {
    id: "sidebar-upcoming",
    toolId: "daily-tasks",
    variantId: "upcoming",
    title: "Upcoming tasks",
    // See `sidebar-overdue`. Discovered by the §6.2b R3 fresh-eyes
    // verifier (2026-05-25): the Upcoming tile is one of the home
    // defaults and opens a popup labelled "Today's tasks" without this
    // override, which reads as a different feature.
    popupTitle: "Upcoming tasks",
    description: "Tasks starting after today.",
    SnapshotTile: UpcomingTasksSnapshot,
    SidebarTile: UpcomingTasksSidebarTile,
    defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
    // Widget per-surface visibility manager (2026-05-25): split the
    // lab-head carve-out per surface. This widget is one of the two
    // new-account home defaults (Upcoming tasks + Today's events)
    // introduced by the §6.2b walkthrough prep, so lab heads MUST see
    // it on /home (home-eligible + home-palette visible). The PI
    // customizable-sidebar palette keeps the original 2026-05-23
    // carve-out ("nudges micromanagement"): a lab head browsing their
    // sidebar palette should NOT see Upcoming tasks alongside the
    // dashboard widgets. Net effect for a lab head:
    //   - /home palette          → visible
    //   - PI sidebar palette     → hidden (sidebar carve-out)
    // The sibling Overdue / Today widgets keep their full PI-sidebar
    // carve-out (`labHeadVisible: false`) because they aren't part of
    // the new home default.
    surfaces: { sidebar: true, home: true },
    memberVisible: true,
    labHeadVisibleOn: { sidebar: false, home: true },
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
    // Tile label is "Daily tasks" (the full-stack overdue + today +
    // upcoming bundle). Tool's umbrella "Today's tasks" header would
    // narrow the popup's apparent scope. widget popup-title manager
    // (2026-05-25).
    popupTitle: "Daily tasks",
    description:
      "The standard daily-tasks sidebar (overdue, today, upcoming, per-project grouping). The default member sidebar, also pinnable by lab heads.",
    SnapshotTile: DailyTasksSnapshot,
    SidebarTile: DailyTasksSidebarTile,
    defaultLayout: { w: 1, h: 1 },
    // Home canvas migration (2026-05-23): members already see this
    // sidebar widget via AppShell's `<DailyTasksSidebar>`, so making
    // it home-eligible lets a lab head ALSO pin daily tasks on /home
    // (mirroring the brief: "the existing DailyTasksSidebar may need
    // to be the home variant since it's the richer one"). The default
    // Home layout doesn't include this — the right sidebar /
    // DailyTasksSidebar already covers it — but it's available in the
    // Home palette for users who want to pin a daily-tasks card
    // directly on the canvas.
    surfaces: { sidebar: true, home: true },
    memberVisible: true,
  },
];

/** Look up a widget definition by id. Returns undefined for unknown ids. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGET_CATALOG.find((w) => w.id === id);
}
