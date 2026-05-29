/**
 * Lab Overview tools registry (Phase C, Tools refactor manager,
 * 2026-05-23).
 *
 * Conceptual model:
 *   - A **Tool** is a canonical domain popup. It owns one `ExpandedView`
 *     component, a title, a description, a small icon, and the
 *     account-type visibility rules (memberVisible / labHeadVisible).
 *     Tools are the things a user "opens" — Purchases, Announcements,
 *     Comments, Notes, Experiments, Daily Tasks, etc.
 *   - A **Widget** (see `components/lab-overview/widgets/registry.ts`)
 *     is a tile shape. Each widget references a Tool by `toolId`. A
 *     Tool can have N widget variants (e.g. `lab-purchases.funding-bars`,
 *     `lab-purchases.burn-rate`, `lab-purchases.pending-count` are three
 *     widget variants of the `purchases` Tool). Clicking any variant
 *     opens the SAME tool popup.
 *
 * Why split:
 *   - the lab-overview canvas previously coupled "thing the user opens"
 *     to "what the tile looks like". The iPhone-style widget metaphor
 *     wanted multiple tile shapes per app — a count pill, a chart, a
 *     progress-bar view, etc., all opening the same app. The Tool/Widget
 *     split makes that natural.
 *   - the new Tools launcher button (top of `/lab-overview`) lists every
 *     tool the active viewer can access, so a tool's popup is reachable
 *     even if the user has no widget for it pinned. The launcher iterates
 *     Tools, not Widgets, so a single Purchases tile shows in the launcher
 *     no matter how many variant tiles the user has on the canvas.
 *
 * Wiring:
 *   - the actual `ExpandedView` components still live in their existing
 *     widget files (e.g. `AnnouncementsWidget.tsx` exports its body as
 *     the default + `ExpandedView` alias). The Tool registry just holds
 *     references to those exports; we don't move the popup bodies. The
 *     refactor is a re-pointer.
 *
 * Visibility model:
 *   - mirrors the existing `visibleCatalog` rules from widgets/types.ts.
 *     `memberVisible: false` → hidden from members. `labHeadVisible:
 *     false` → hidden from lab heads (rare carve-out; today only the
 *     personal task widgets use it).
 */
import type { ComponentType } from "react";
import {
  visibleCatalog,
  widgetHasSurface,
  type ExpandedViewProps,
} from "@/components/lab-overview/widgets/types";
import { WIDGET_CATALOG } from "@/components/lab-overview/widgets/registry";
import type { AccountType } from "@/lib/settings/user-settings";

// ── ExpandedView imports ─────────────────────────────────────────────────
// Pull the existing popup bodies from each widget file. The bodies are
// unchanged; only the wiring (where they're looked up) moves.
import { ExpandedView as AnnouncementsExpanded } from "@/components/lab-overview/widgets/AnnouncementsWidget";
import { ExpandedView as CommentFeedExpanded } from "@/components/lab-overview/widgets/CommentFeedWidget";
import { ExpandedView as MetricsExpanded } from "@/components/lab-overview/widgets/MetricsWidget";
import { ExpandedView as RecentActivityExpanded } from "@/components/lab-overview/widgets/RecentActivityWidget";
import { ExpandedView as PiActionsExpanded } from "@/components/lab-overview/widgets/PiActionsWidget";
import { ExpandedView as MemberWorkloadExpanded } from "@/components/lab-overview/widgets/MemberWorkloadWidget";
import { ExpandedView as TodaysAnnouncementsExpanded } from "@/components/lab-overview/widgets/TodaysAnnouncementsWidget";
import { ExpandedView as LabNotesExpanded } from "@/components/lab-overview/widgets/LabNotesWidget";
import { ExpandedView as LabExperimentsExpanded } from "@/components/lab-overview/widgets/LabExperimentsWidget";
import { ExpandedView as LabActivityExpanded } from "@/components/lab-overview/widgets/LabActivityWidget";
import { ExpandedView as LabPurchasesExpanded } from "@/components/lab-overview/widgets/LabPurchasesWidget";
import { ExpandedView as DailyTasksExpanded } from "@/components/lab-overview/widgets/DailyTasksWidget";
// Calendar Tool DayView variant manager (2026-05-24): the calendar
// Tool's popup body is now the DayView popup variant, not the
// today's-list placeholder from chip 06947539. The today's-list still
// powers the SnapshotTile + SidebarTile of CalendarEventsTodayWidget,
// it's only the popup ExpandedView that switches.
import { ExpandedView as CalendarDayPopupExpanded } from "@/components/lab-overview/widgets/CalendarDayPopupView";
// Trainee notes + weekly goals Tool (PI beta feedback, weekly-goals
// widget, 2026-05-29): a lab-roster surface where clicking a member
// surfaces the notes AND weekly goals that member has SHARED with the
// viewer. Read-only; respects the same canRead + shared_only gates
// LabNotesWidget uses. Supports a single-member-pinned mode via the
// per-instance widget config.
import { ExpandedView as TraineeNotesExpanded } from "@/components/lab-overview/widgets/TraineeNotesWidget";
// Weekly goals capture Tool (PI beta feedback, weekly-goals widget,
// 2026-05-29): the trainee-facing capture box. Add / toggle-done /
// delete the lightweight weekly goals set in 1:1s. Distinct from the
// Gantt goal system.
import { ExpandedView as WeeklyGoalsExpanded } from "@/components/lab-overview/widgets/WeeklyGoalsWidget";

// ── Small inline icons (no emojis, no lucide-react) ───────────────────────
// Each tool gets a 16x16 SVG. Pulled from / mirrors the existing widget
// icon constants. Kept here so the launcher doesn't have to reach into
// each widget file. The shape (`<svg>` element) renders inline; the
// caller styles colour via `currentColor`.

const ICON_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const ANNOUNCEMENTS_ICON = (
  // Megaphone — mirrors MEGAPHONE_SVG from AnnouncementsWidget.
  <svg {...ICON_PROPS}>
    <path d="M3 11l18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

const COMMENTS_ICON = (
  // Chat bubble — mirrors CHAT_SVG from CommentFeedWidget.
  <svg {...ICON_PROPS}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const NOTES_ICON = (
  // Document — mirrors DOC_SVG from LabNotesWidget.
  <svg {...ICON_PROPS}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const EXPERIMENTS_ICON = (
  // Flask. Distinct from the generic chart icons.
  <svg {...ICON_PROPS}>
    <path d="M9 2v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19L15 8V2" />
    <line x1="7" y1="2" x2="17" y2="2" />
  </svg>
);

const PURCHASES_ICON = (
  // Dollar sign — mirrors PURCHASES_TILE_ICON from LabPurchasesWidget.
  <svg {...ICON_PROPS}>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const METRICS_ICON = (
  // Line chart — mirrors METRICS_ICON from MetricsWidget.
  <svg {...ICON_PROPS}>
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-6" />
  </svg>
);

const DAILY_TASKS_ICON = (
  // Checkbox — mirrors CHECKBOX_SVG from DailyTasksWidget.
  <svg {...ICON_PROPS}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <polyline points="9 12 11 14 16 9" />
  </svg>
);

const LAB_ACTIVITY_ICON = (
  // Activity pulse — mirrors ACTIVITY_ICON from LabActivityWidget.
  <svg {...ICON_PROPS}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const RECENT_ACTIVITY_ICON = (
  // Clock — captures "recent" temporally.
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const PI_ACTIONS_ICON = (
  // Shield with check — mirrors SHIELD_ICON from PiActionsWidget.
  <svg {...ICON_PROPS}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const MEMBER_WORKLOAD_ICON = (
  // People — mirrors PEOPLE_ICON from MemberWorkloadWidget.
  <svg {...ICON_PROPS}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const TODAYS_ANNOUNCEMENTS_ICON = (
  // Pin — mirrors PIN_SVG from TodaysAnnouncementsWidget.
  <svg {...ICON_PROPS}>
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" />
  </svg>
);

const TRAINEE_NOTES_ICON = (
  // People + document hint. Mirrors the PEOPLE_SVG roster motif from
  // TraineeNotesWidget (a roster you click into to read shared notes).
  <svg {...ICON_PROPS}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const CALENDAR_ICON = (
  // Calendar grid. Mirrors CALENDAR_SVG from CalendarEventsTodayWidget.
  <svg {...ICON_PROPS}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const WEEKLY_GOALS_ICON = (
  // Target / bullseye. Mirrors TARGET_SVG from WeeklyGoalsWidget. Distinct
  // from the Gantt goal motif — weekly goals are a separate concept.
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

// ── Tool definitions ─────────────────────────────────────────────────────

export interface ToolDefinition {
  /** Canonical tool id. Stable across catalog churn. Used by widget
   *  entries' `toolId` field + by the Tools launcher as a click key. */
  id: string;
  /** Human label shown in the launcher tile + the popup chrome. */
  title: string;
  /** One-line description for the launcher tile hover/aria. */
  description?: string;
  /** Small inline SVG. Caller styles colour via `currentColor`. */
  Icon: React.ReactElement;
  /** The popup body. Reused by every widget variant referencing this
   *  tool's id. */
  ExpandedView: ComponentType<ExpandedViewProps>;
  /** Visibility: member sees the tool in the launcher + the popup. */
  memberVisible: boolean;
  /** Visibility: lab_head sees the tool in the launcher + the popup.
   *  Defaults true. Set to `false` for tools that are PI-only carve-outs
   *  (none in the first pass, but mirrored from the widget rules). */
  labHeadVisible?: boolean;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    id: "announcements",
    title: "Announcements",
    description: "Lab-wide updates. PIs post, members read.",
    Icon: ANNOUNCEMENTS_ICON,
    ExpandedView: AnnouncementsExpanded,
    memberVisible: true,
  },
  {
    id: "comments",
    title: "Lab comments",
    description: "Every comment thread across the lab, newest first.",
    Icon: COMMENTS_ICON,
    ExpandedView: CommentFeedExpanded,
    memberVisible: true,
  },
  {
    id: "notes",
    title: "Lab notes",
    description: "Cross-lab notes the viewer can read, searchable + filterable.",
    Icon: NOTES_ICON,
    ExpandedView: LabNotesExpanded,
    memberVisible: true,
  },
  {
    id: "experiments",
    title: "Lab experiments",
    description: "Outcome gallery of every lab member's experiments.",
    Icon: EXPERIMENTS_ICON,
    ExpandedView: LabExperimentsExpanded,
    memberVisible: true,
  },
  {
    id: "purchases",
    title: "Lab purchases",
    description: "Pending approvals, recent purchases, funding rollup.",
    Icon: PURCHASES_ICON,
    ExpandedView: LabPurchasesExpanded,
    memberVisible: false,
  },
  {
    id: "metrics",
    title: "Lab metrics",
    description: "Cross-lab Gantt overlay + funding + roadmap rollup.",
    Icon: METRICS_ICON,
    ExpandedView: MetricsExpanded,
    memberVisible: false,
  },
  {
    // Trainee notes + weekly goals (PI beta feedback, weekly-goals
    // widget, 2026-05-29; extends pi-notes-widget, 2026-05-29). PI-only:
    // a roster where clicking a member surfaces the notes AND weekly
    // goals that member has shared with the PI. Read-only and gated by
    // the same shared_only + canRead checks LabNotesWidget uses; never
    // exposes a member's private notes or goals. Supports a
    // single-member-pinned mode via the per-instance widget config.
    id: "trainee-notes",
    title: "Trainee notes & goals",
    description:
      "Lab roster; click a member to read the notes and weekly goals they've shared with you. Pin to one trainee.",
    Icon: TRAINEE_NOTES_ICON,
    ExpandedView: TraineeNotesExpanded,
    memberVisible: false,
  },
  {
    // Weekly goals capture (PI beta feedback, weekly-goals widget,
    // 2026-05-29). The trainee-facing box for logging the lightweight
    // weekly goals set in 1:1s. Member-visible. Distinct from the Gantt
    // goal system; a weekly goal never lands on the Gantt.
    id: "weekly-goals",
    title: "Weekly goals",
    description:
      "Log the lightweight goals you set in your 1:1 meetings. Shared goals are visible to your PI.",
    Icon: WEEKLY_GOALS_ICON,
    ExpandedView: WeeklyGoalsExpanded,
    memberVisible: true,
  },
  {
    id: "daily-tasks",
    title: "Today's tasks",
    description: "Personal overdue / today / upcoming tasks.",
    Icon: DAILY_TASKS_ICON,
    ExpandedView: DailyTasksExpanded,
    memberVisible: true,
  },
  {
    id: "lab-activity",
    title: "Lab activity",
    description:
      "Paginated activity feed across the lab (comments, tasks, flags, announcements).",
    Icon: LAB_ACTIVITY_ICON,
    ExpandedView: LabActivityExpanded,
    memberVisible: true,
  },
  {
    id: "recent-activity",
    title: "Recent lab activity",
    description: "Newest comments, shares, and task creations across the lab.",
    Icon: RECENT_ACTIVITY_ICON,
    ExpandedView: RecentActivityExpanded,
    memberVisible: true,
  },
  {
    id: "pi-actions",
    title: "Pending PI actions",
    description: "Purchase approvals + flag queue + audit acks awaiting you.",
    Icon: PI_ACTIONS_ICON,
    ExpandedView: PiActionsExpanded,
    memberVisible: false,
  },
  {
    id: "member-workload",
    title: "Member workload",
    description: "Open + overdue counts per lab member.",
    Icon: MEMBER_WORKLOAD_ICON,
    ExpandedView: MemberWorkloadExpanded,
    memberVisible: false,
  },
  {
    id: "todays-announcements",
    title: "Today's announcements",
    description: "Pinned announcements, titles only.",
    Icon: TODAYS_ANNOUNCEMENTS_ICON,
    ExpandedView: TodaysAnnouncementsExpanded,
    memberVisible: true,
  },
  {
    // Calendar Tool. SnapshotTile + SidebarTile of
    // CalendarEventsTodayWidget still summarise today's events. The
    // popup body is the DayView variant (Calendar Tool DayView variant
    // manager, 2026-05-24): a single-day timeline sized for the popup
    // shell, with prev/next-day nav and an "Open full calendar" CTA.
    // Replaces the today's-list placeholder from chip 06947539 which
    // couldn't host the AppShell-dependent /calendar grid.
    id: "calendar",
    title: "Calendar",
    description: "Today's events across your subscribed calendars.",
    Icon: CALENDAR_ICON,
    ExpandedView: CalendarDayPopupExpanded,
    memberVisible: true,
  },
];

/** Look up a Tool by id. Returns undefined for unknown ids. */
export function getTool(id: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.id === id);
}

/**
 * Filter the tool registry to the entries a given account type is
 * allowed to open. Mirrors `visibleCatalog` from widgets/types.ts but
 * runs over Tools, not Widgets.
 *
 * Home canvas migration (Home canvas migration manager, 2026-05-23):
 * the optional `surface` arg further scopes the launcher to Tools
 * whose AT LEAST ONE widget variant is eligible for the given surface.
 * Otherwise the /home launcher would list (e.g.) "PI actions" — a Tool
 * whose only widget is sidebar-only, opening a popup the user can't
 * pin via the home canvas. Pass `undefined` for the legacy
 * "all-allowed-tools" behavior used by /lab-overview's launcher (it
 * sees every Tool the viewer can open, regardless of where its
 * widgets live).
 */
export function visibleTools(
  accountType: AccountType,
  surface?: "canvas" | "sidebar" | "home",
): ToolDefinition[] {
  const accountFiltered =
    accountType === "lab_head"
      ? TOOL_REGISTRY.filter((t) => t.labHeadVisible !== false)
      : TOOL_REGISTRY.filter((t) => t.memberVisible);
  if (!surface) return accountFiltered;

  // Build the set of tool ids that have at least one widget variant
  // eligible for the requested surface AND visible to this account
  // type. Without the account filter on the widget side, the launcher
  // could surface a tool that's PI-only via a hidden PI widget.
  // Widget per-surface visibility manager (2026-05-25): pass `surface`
  // through so per-surface lab-head carve-outs (e.g. sidebar-upcoming
  // hidden from the PI sidebar palette but home-eligible) propagate to
  // the launcher: if every widget variant of a Tool is carved out of
  // this surface for lab heads, the Tool itself drops off the
  // surface-scoped launcher.
  const widgetCatalogForAccount = visibleCatalog(
    WIDGET_CATALOG,
    accountType,
    surface,
  );
  const eligibleToolIds = new Set(
    widgetCatalogForAccount
      .filter((w) => widgetHasSurface(w, surface))
      .map((w) => w.toolId),
  );
  return accountFiltered.filter((t) => eligibleToolIds.has(t.id));
}

/**
 * Resolve a widget's popup body via its `toolId`. The Tool registry is
 * the single source of truth (Back-compat removal manager, 2026-05-23:
 * the per-widget `ExpandedView` field on `WidgetDefinition` was dropped;
 * there is no widget-level fallback). If `toolId` doesn't match a
 * registered Tool the resolver returns a diagnostic placeholder so the
 * surface keeps rendering and the bug is obvious in the popup, rather
 * than crashing the canvas / sidebar tree.
 */
export function resolveExpandedView(widget: {
  toolId: string;
}): ComponentType<ExpandedViewProps> {
  const tool = getTool(widget.toolId);
  if (tool) return tool.ExpandedView;
  const missingId = widget.toolId;
  const MissingToolPlaceholder: ComponentType<ExpandedViewProps> = () => (
    <div
      role="alert"
      style={{
        padding: 24,
        color: "#b91c1c",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <strong>Widget configuration error.</strong>
      <div style={{ marginTop: 8 }}>
        Tool <code>{missingId}</code> is not registered in
        <code> TOOL_REGISTRY</code>. Add the tool definition in
        <code> lib/lab-overview/tool-registry.tsx</code> or fix the
        widget&apos;s <code>toolId</code>.
      </div>
    </div>
  );
  MissingToolPlaceholder.displayName = "MissingToolPlaceholder";
  return MissingToolPlaceholder;
}

/**
 * Resolve the popup title for a widget. Resolution order:
 *
 *   1. `widget.popupTitle` (per-widget override): set on the catalog
 *      entry when a tile-variant of a shared Tool needs a focused popup
 *      header that mirrors its tile label rather than the Tool's
 *      umbrella title. Example: the `sidebar-upcoming` tile (label
 *      "Upcoming tasks") sharing the daily-tasks Tool should open a
 *      popup titled "Upcoming tasks", not the Tool title "Today's
 *      tasks". (widget popup-title manager, 2026-05-25.)
 *   2. Tool registry title: keeps multi-variant Tools that DON'T set
 *      an override consistent (e.g. all 3 purchases variants still show
 *      "Lab purchases" in the popup chrome).
 *   3. Widget's own `title`: last-resort fallback if the Tool is
 *      missing from the registry (defensive; surfaces the diagnostic
 *      placeholder from `resolveExpandedView` if it ever happens).
 */
export function resolveToolTitle(widget: {
  toolId: string;
  title: string;
  popupTitle?: string;
}): string {
  if (widget.popupTitle) return widget.popupTitle;
  return getTool(widget.toolId)?.title ?? widget.title;
}
