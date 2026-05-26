"use client";

/**
 * CalendarEventsTodayWidget (CalendarEventsTodayWidget manager, 2026-05-24):
 * the "today's events" widget surfaced on the /home canvas.
 *
 * Before this widget existed the home default layout pointed the
 * today's-events slot at `sidebar-todays-announcements` (the
 * TodaysAnnouncementsWidget) as the closest semantic match. Grant
 * confirmed "i like the events today widget" meaning the true calendar-
 * events-today tile, so this chip ships that dedicated tile and the
 * default home layout swaps over to point at it.
 *
 * Wiring: Tool = `calendar` (new Tool registered in
 * `lib/lab-overview/tool-registry.tsx`), variantId = `today`. The
 * canonical calendar surface is the /calendar app page — it isn't a
 * pop-out body today, so the Tool's ExpandedView wraps a CTA that walks
 * the user to /calendar. Replacing that with a popup-shell calendar
 * variant is tracked as a FOLLOW-UP at the bottom of this file.
 *
 * Data: native ResearchOS events come from `eventsApi.list()` via the
 * shared `["events"]` React Query key (dedupes with /calendar,
 * CalendarSidebar, DailyTasksSidebar). External feed events come from
 * `useExternalEvents()` which itself shares its `calendar-feed-events`
 * cache with the rest of the calendar surface. No new query keys are
 * introduced: both SnapshotTile + SidebarTile read the same hooks and
 * React Query's dedupe keeps the wire cost at zero when the user is
 * already on /calendar or has /home open with the sidebar mounted.
 *
 * Time semantics: today is `toLocalDateString(new Date())` (local
 * timezone, NOT UTC, to match the rest of the calendar surface). An
 * event is "today" if today falls within `[start_date, end_date]`
 * inclusive (mirrors `eventCoversDate`). All-day events (no
 * `start_time`) sort before timed events, then ascending by start_time.
 *
 * No emojis (Grant feedback rule). No em-dashes in prose I write here.
 * Tooltips via `<Tooltip>` (not native `title=`) for icon-only
 * affordances. */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/local-api";
import { useExternalEvents } from "@/lib/calendar/use-external-events";
import { usePopupActions } from "@/lib/lab-overview/popup-actions";
import {
  EVENT_TYPE_COLORS,
  formatTime,
  toLocalDateString,
  eventTimeOrder,
} from "@/components/calendar/utils";
import type { Event, ExternalEvent } from "@/lib/types";
import type { SidebarTileProps, SnapshotTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";
// §6.2b Home widgets walkthrough demo-preview hook (tour-fixtures
// sub-bot R2, 2026-05-26): when the §6.2b cluster's step bodies push a
// demo-preview lease, the SnapshotTile below short-circuits the
// real-events fetch and renders a 4-row fixture so BeakerBot's "the
// top few rows give you the gist" pitch lands on something other than
// "Nothing on the calendar today" for a brand-new account.
import { useTourWidgetDemoPreview } from "@/components/onboarding/v4/TourWidgetDemoPreview";

// ─────────────────────────────────────────────────────────────────────────
// Inline calendar icon. Two sizes used: 14px for headers / tiles, 16px
// for the Tool launcher (registered in `tool-registry.tsx`).
// ─────────────────────────────────────────────────────────────────────────

const CALENDAR_SVG = (size: number) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

/** Friendly empty-state icon. A cup-of-tea silhouette to read as
 *  "nothing on the calendar, relax". Matches the project's pattern of
 *  custom inline SVGs (no lucide-react). */
const EMPTY_TEA_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
    <line x1="6" y1="2" x2="6" y2="4" />
    <line x1="10" y1="2" x2="10" y2="4" />
    <line x1="14" y1="2" x2="14" y2="4" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────
// Shared row shape + selectors
// ─────────────────────────────────────────────────────────────────────────

type TodayRow =
  | { kind: "native"; event: Event; color: string }
  | { kind: "external"; event: ExternalEvent; color: string };

/** Returns true if `dateStr` (YYYY-MM-DD) falls within the event's
 *  inclusive start_date..end_date range. Local copy so we don't widen
 *  the calendar utils' surface for one extra import. */
function coversDate(
  e: { start_date: string; end_date: string | null },
  dateStr: string,
): boolean {
  const start = e.start_date;
  const end = e.end_date || e.start_date;
  return dateStr >= start && dateStr <= end;
}

/** Sort rows: untimed (all-day) first, then ascending by start_time. */
function sortRows(rows: TodayRow[]): TodayRow[] {
  return [...rows].sort((a, b) =>
    eventTimeOrder(a.event, b.event),
  );
}

/** Pretty-print the time range for a row. All-day events return
 *  "All day"; events with start but no end return the start time only;
 *  full ranges show "9a - 10a". */
function timeRangeLabel(e: { start_time: string | null; end_time: string | null }): string {
  if (!e.start_time) return "All day";
  const start = formatTime(e.start_time);
  if (!e.end_time) return start;
  return `${start} - ${formatTime(e.end_time)}`;
}

/** Pull native event color (per-type fallback) into a single string. */
function nativeEventColor(e: Event): string {
  return e.color || EVENT_TYPE_COLORS[e.event_type] || "#3b82f6";
}

// ─────────────────────────────────────────────────────────────────────────
// Hook: useTodayRows
// ─────────────────────────────────────────────────────────────────────────
//
// Both SnapshotTile + SidebarTile + ExpandedView read this. React Query
// dedupes the underlying `["events"]` + `calendar-feed-events` reads so
// the three consumers share one fetch.

function useTodayRows(): { rows: TodayRow[]; isLoading: boolean } {
  const todayStr = toLocalDateString(new Date());
  const { data: nativeEvents = [], isLoading: nativeLoading } = useQuery({
    queryKey: ["events"],
    queryFn: eventsApi.list,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { events: externalEvents, isLoading: externalLoading } = useExternalEvents();

  const rows = useMemo<TodayRow[]>(() => {
    const out: TodayRow[] = [];
    for (const e of nativeEvents) {
      if (coversDate(e, todayStr)) {
        out.push({ kind: "native", event: e, color: nativeEventColor(e) });
      }
    }
    for (const e of externalEvents) {
      if (coversDate(e, todayStr)) {
        out.push({ kind: "external", event: e, color: e.color });
      }
    }
    return sortRows(out);
  }, [nativeEvents, externalEvents, todayStr]);

  return { rows, isLoading: nativeLoading || externalLoading };
}

// ─────────────────────────────────────────────────────────────────────────
// ExpandedView (popup body)
// ─────────────────────────────────────────────────────────────────────────
//
// FOLLOW-UP: the canonical full-calendar view lives at the /calendar
// route and depends on AppShell chrome (sidebar, top nav, modals). It
// doesn't render cleanly inside a popup body. For now the ExpandedView
// renders a richer today-list (full title + time + location + a "View
// full calendar" link) so the popup is useful even without the month /
// week / day grid. A future chip should build a popup-shell calendar
// variant (e.g. a DayView wrapper sized for the popup) and swap that in
// as this Tool's ExpandedView.

export default function CalendarEventsTodayWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { rows, isLoading } = useTodayRows();
  // Popup-close hook (commit 911614ba): clicking "Open full calendar"
  // tears down the popup before the client nav so the user lands on
  // /calendar without the widget popup still mounted. Outside a popup
  // the hook is a no-op default.
  const { closePopup } = usePopupActions();

  if (isLoading) {
    return <div className="text-xs text-gray-400 italic">Loading...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-gray-400">
        <span aria-hidden="true">{EMPTY_TEA_SVG}</span>
        <p className="text-xs italic">Nothing on the calendar today</p>
        <Link
          href="/calendar"
          onClick={() => closePopup()}
          className="mt-2 text-[11px] text-blue-600 hover:underline"
        >
          Open full calendar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <ul className="space-y-2">
        {rows.map((row) => {
          const key =
            row.kind === "native"
              ? `native:${row.event.id}`
              : `external:${row.event.id}`;
          const e = row.event;
          return (
            <li
              key={key}
              className="flex items-start gap-2 text-xs text-gray-700"
            >
              <span
                aria-hidden="true"
                className="mt-1 inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: row.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 truncate">
                  {e.title || "Untitled event"}
                </p>
                <p className="text-[11px] text-gray-500 truncate">
                  {timeRangeLabel(e)}
                  {e.location ? ` - ${e.location}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href="/calendar"
        onClick={() => closePopup()}
        className="mt-1 pt-2 border-t border-gray-100 text-[11px] text-blue-600 hover:underline self-start"
      >
        Open full calendar
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Demo-preview fixture rows (tour-fixtures sub-bot R2, 2026-05-26)
// ─────────────────────────────────────────────────────────────────────────
//
// Used by the §6.2b walkthrough cluster. The fixture is 4 plausible
// today-events for a working lab (lab meeting, transformations,
// imaging, paper deadline), enough rows that the "+N more" footer
// doesn't kick in (overflow ceiling is 5) but enough density that the
// tile reads as a busy day. No emojis, no em-dashes, light fictional
// content (no real PI / project / strain names).
const DEMO_TODAY_ROWS: TodayRow[] = [
  {
    kind: "native",
    event: {
      id: -1,
      title: "Lab meeting",
      event_type: "meeting",
      start_date: "1970-01-01",
      end_date: null,
      start_time: "09:00",
      end_time: "10:00",
      location: "Conf rm 2",
      url: null,
      notes: null,
      color: null,
    },
    color: EVENT_TYPE_COLORS.meeting,
  },
  {
    kind: "native",
    event: {
      id: -2,
      title: "Yeast transformations",
      event_type: "other",
      start_date: "1970-01-01",
      end_date: null,
      start_time: "11:00",
      end_time: "13:30",
      location: null,
      url: null,
      notes: null,
      color: null,
    },
    color: EVENT_TYPE_COLORS.other,
  },
  {
    kind: "native",
    event: {
      id: -3,
      title: "Confocal imaging slot",
      event_type: "other",
      start_date: "1970-01-01",
      end_date: null,
      start_time: "14:00",
      end_time: "16:00",
      location: "Imaging core",
      url: null,
      notes: null,
      color: null,
    },
    color: EVENT_TYPE_COLORS.other,
  },
  {
    kind: "native",
    event: {
      id: -4,
      title: "Methods draft due",
      event_type: "deadline",
      start_date: "1970-01-01",
      end_date: null,
      start_time: "17:00",
      end_time: null,
      location: null,
      url: null,
      notes: null,
      color: null,
    },
    color: EVENT_TYPE_COLORS.deadline,
  },
];

// ─────────────────────────────────────────────────────────────────────────
// SnapshotTile
// ─────────────────────────────────────────────────────────────────────────
//
// Header (calendar icon + "Today" label) + up to 5 event rows (color
// dot + title + time range). "+N more" footer when the day has more
// than 5 events. Empty state shows the tea icon + "Nothing on the
// calendar today" cue.

export function SnapshotTile(_props: SnapshotTileProps) {
  // §6.2b walkthrough demo-preview short-circuit (tour-fixtures sub-bot
  // R2, 2026-05-26): when the cluster has pushed a demo lease, render
  // the inline fixture rows instead of the real data path. Hook order
  // is preserved (still call useTodayRows) so the React-rules-of-hooks
  // contract holds across the toggle.
  const isDemoPreview = useTourWidgetDemoPreview();
  const realToday = useTodayRows();
  const rows = isDemoPreview ? DEMO_TODAY_ROWS : realToday.rows;
  const isLoading = isDemoPreview ? false : realToday.isLoading;
  const top = rows.slice(0, 5);
  const overflow = rows.length - top.length;

  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          aria-hidden="true"
          className="text-blue-500 flex items-center justify-center flex-shrink-0"
        >
          {CALENDAR_SVG(14)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium truncate">
          Today&apos;s events
        </span>
      </div>
      {isLoading ? (
        <p className="text-xs text-gray-400 italic">Loading...</p>
      ) : top.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-gray-400">
          <span aria-hidden="true">{EMPTY_TEA_SVG}</span>
          <p className="text-xs italic">Nothing on the calendar today</p>
        </div>
      ) : (
        <ul className="flex-1 flex flex-col gap-1.5 min-h-0">
          {top.map((row) => {
            const key =
              row.kind === "native"
                ? `native:${row.event.id}`
                : `external:${row.event.id}`;
            const e = row.event;
            return (
              <li
                key={key}
                className="flex items-start gap-2 min-w-0"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 truncate leading-snug">
                    {e.title || "Untitled event"}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate leading-tight">
                    {timeRangeLabel(e)}
                  </p>
                </div>
              </li>
            );
          })}
          {overflow > 0 && (
            <li className="text-[10px] text-gray-400 pl-4">
              +{overflow} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SidebarTile
// ─────────────────────────────────────────────────────────────────────────
//
// Slim horizontal row: calendar icon + label ("Today") + count badge
// in the right slot + a one-line preview of the first event (sub
// slot). When empty, shows a quiet "Nothing today" sub line and a 0
// pill so the row reads uniformly with neighbors.

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { rows, isLoading } = useTodayRows();
  const count = rows.length;
  const first = rows[0];

  // Empty: fall back to the canonical SidebarStatTile so the row
  // matches the visual rhythm of its neighbors.
  if (!isLoading && count === 0) {
    return (
      <SidebarStatTile
        icon={CALENDAR_SVG(14)}
        iconClassName="text-blue-500"
        label="Today"
        stat={
          <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 text-[11px] font-semibold tabular-nums">
            0
          </span>
        }
        sub="Nothing today"
        onClick={onClick}
      />
    );
  }

  // Loading: show a quiet em-dash so the row doesn't collapse.
  if (isLoading) {
    return (
      <SidebarStatTile
        icon={CALENDAR_SVG(14)}
        iconClassName="text-blue-500"
        label="Today"
        stat="-"
        onClick={onClick}
      />
    );
  }

  // Populated: count pill + preview line of the first event.
  const previewTitle = first?.event.title || "Untitled event";
  const previewTime = first ? timeRangeLabel(first.event) : "";
  const previewLine = previewTime ? `${previewTitle} (${previewTime})` : previewTitle;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full flex flex-col gap-1 px-2.5 py-2 rounded-md cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className="text-blue-500 flex items-center justify-center flex-shrink-0"
        >
          {CALENDAR_SVG(14)}
        </span>
        <span className="text-xs font-medium text-gray-700 truncate flex-1 min-w-0">
          Today
        </span>
        <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[11px] font-semibold tabular-nums flex-shrink-0">
          {count}
        </span>
      </div>
      <p className="text-[11px] text-gray-500 truncate pl-6" title={previewLine}>
        {previewLine}
      </p>
    </div>
  );
}

// Tool registry alias: the default-export ExpandedView is imported by
// `lib/lab-overview/tool-registry.tsx` as
// `import { ExpandedView as CalendarEventsTodayExpanded } from
// "@/components/lab-overview/widgets/CalendarEventsTodayWidget"`.
export const ExpandedView = CalendarEventsTodayWidget;

/**
 * Mira PI R1 fix manager (Fix 3, 2026-05-25): help-badge copy for the
 * today variant of the Calendar tile. Matches Chip B voice
 * (pedagogical, no em-dashes, no emojis).
 */
export const HELP_TEXT =
  "Calendar events scheduled for today across the lab. Click an event to open it; covers internal events plus any synced external calendars.";
