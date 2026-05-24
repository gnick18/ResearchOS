"use client";

/**
 * CalendarDayPopupView (Calendar Tool DayView variant manager,
 * 2026-05-24):
 *
 * Popup-shell variant of the calendar Tool. The chip 06947539 shipped a
 * placeholder ExpandedView (a richer today-list with a CTA out to
 * /calendar) because the canonical /calendar page depends on AppShell
 * chrome (sidebar, top nav, modals) and doesn't render cleanly inside a
 * popup body. This component is the proper popup variant.
 *
 * What it is:
 *   - A single-day timeline view (hour grid + all-day strip), sized to
 *     fit the SnapshotTilePopup body (~max-w-5xl, h-85vh).
 *   - Defaults to today. Header arrows step the selected date by +/- 1
 *     day. A "Today" pill resets back when the user has navigated away.
 *   - Renders BOTH native ResearchOS events and external feed events,
 *     reusing the same data hooks the /calendar page uses (no new
 *     React Query keys; the cache dedupes across all calendar
 *     consumers).
 *   - The "Open full calendar" CTA in the header is a Next Link to
 *     /calendar. When the parallel popup-close hook
 *     (`usePopupActions().closePopup()`) lands, swap the onClick to
 *     call `closePopup()` first so the popup tears down cleanly before
 *     the route navigates. FOLLOW-UP at the bottom of this file.
 *
 * What it isn't:
 *   - A full month / week grid. The popup is too narrow for a useful
 *     month view; users who want that open the full /calendar page.
 *   - An event editor. Clicks on events are intentionally no-ops in
 *     this view; creating / editing events stays on /calendar where
 *     the full modal suite lives. (Future chip could add an inline
 *     read-only event detail popover; tracked as FOLLOW-UP.)
 *
 * Data wiring:
 *   - Native events: `useQuery({ queryKey: ["events"] })` — same key
 *     as /calendar, CalendarSidebar, DailyTasksSidebar,
 *     CalendarEventsTodayWidget. Single fetch shared across all five.
 *   - External feeds: `useExternalEvents()` from
 *     `lib/calendar/use-external-events.ts` — same hook as /calendar.
 *     Its per-feed `["calendar-feed-events", feedId, kind, url]` keys
 *     dedupe across all consumers.
 *
 * Visual primitives: reuses `EVENT_TYPE_COLORS`, `formatTime`,
 * `timeToMinutes`, `toLocalDateString`, `splitDayItems`,
 * `eventTimeOrder`, `assignLanes` from `components/calendar/utils.ts`.
 * Mirrors the lane-packing + now-line behaviour of the canonical
 * `components/calendar/DayView.tsx` so the popup feels native to users
 * who recognise the full /calendar day view.
 *
 * Style rules:
 *   - No emojis (Grant feedback). All icons are custom inline SVGs.
 *   - No em-dashes in prose I author here.
 *   - Tooltip wraps every icon-only affordance via `<Tooltip>` (not
 *     native `title=`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "@/lib/local-api";
import { useExternalEvents } from "@/lib/calendar/use-external-events";
import { hasEnded } from "@/lib/calendar/event-status";
import { getReadableTextColor } from "@/lib/colors";
import Tooltip from "@/components/Tooltip";
import { usePopupActions } from "@/lib/lab-overview/popup-actions";
import {
  assignLanes,
  EVENT_TYPE_COLORS,
  eventTimeOrder,
  formatTime,
  splitDayItems,
  timeToMinutes,
  toLocalDateString,
  type CalendarItem,
} from "@/components/calendar/utils";
import type { ExpandedViewProps } from "./types";

// ── Geometry ─────────────────────────────────────────────────────────────
// The popup body is ~max-w-5xl (~1024px) and ~85vh tall. The popup
// chrome (header bar + outer padding) eats ~80px, the in-body day
// header eats ~64px, and the all-day strip is variable. Sizing the
// hourly grid to a fixed 48px/hr gives a 1152px total height that the
// inner scroll container can paginate; users land scrolled to "now"
// (or 7am on past/future days) so most days don't need a scroll.
const HOUR_HEIGHT = 48;
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;

// ── Inline icons (no emojis) ─────────────────────────────────────────────

const CHEVRON_LEFT_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const CHEVRON_RIGHT_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const EXTERNAL_LINK_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="flex-shrink-0"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/** Linked-event icon (external chain link), mirrors the inline icon in
 *  components/calendar/DayView.tsx so external rows read the same. */
const EXTERNAL_CHAIN_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="flex-shrink-0"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const EMPTY_TEA_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
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

// Greyed-out style for past events; matches the canonical DayView.
const ENDED_CLASSES = "line-through opacity-60";

// ── Component ────────────────────────────────────────────────────────────

export default function CalendarDayPopupView(_props: ExpandedViewProps) {
  // Popup-close hook (commit 911614ba): "Open full calendar" tears
  // down the popup before client-nav so the user lands on /calendar
  // without the popup still mounted on top. Outside a popup the hook
  // is a no-op default.
  const { closePopup } = usePopupActions();
  // Selected day. Stored as a Date so step / today helpers stay
  // straightforward, but compared via toLocalDateString to dodge the
  // timezone trap that bites toISOString().
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const dateStr = toLocalDateString(anchor);
  const todayStr = toLocalDateString(new Date());
  const isToday = dateStr === todayStr;

  // Shared data: React Query dedupes the ["events"] fetch across every
  // calendar consumer (SnapshotTile + SidebarTile + /calendar page +
  // CalendarSidebar + DailyTasksSidebar), so the popup body costs
  // nothing extra when the user already had any of them mounted.
  const { data: nativeEvents = [], isLoading: nativeLoading } = useQuery({
    queryKey: ["events"],
    queryFn: eventsApi.list,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const {
    events: externalEvents,
    errorsByFeedId,
    isLoading: externalLoading,
  } = useExternalEvents();

  const items = useMemo<CalendarItem[]>(() => {
    const out: CalendarItem[] = [];
    for (const e of nativeEvents) {
      if (dateStr >= e.start_date && dateStr <= (e.end_date || e.start_date)) {
        out.push({ kind: "native", event: e });
      }
    }
    for (const e of externalEvents) {
      if (dateStr >= e.start_date && dateStr <= (e.end_date || e.start_date)) {
        out.push({ kind: "external", event: e });
      }
    }
    return out;
  }, [dateStr, nativeEvents, externalEvents]);

  const { allDay, timed } = useMemo(
    () => splitDayItems(items, dateStr),
    [items, dateStr],
  );
  const sortedAllDay = useMemo(
    () => [...allDay].sort((a, b) => eventTimeOrder(a.event, b.event)),
    [allDay],
  );
  const laneAssignments = useMemo(() => assignLanes(timed), [timed]);

  // Scroll to "now" on today, 7am otherwise. Re-runs only when the day
  // toggles between today and not (deliberate: re-running on every
  // anchor change would yank the user's manual scroll position).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    const targetMinutes = isToday
      ? now.getHours() * 60 + now.getMinutes() - 60
      : 7 * 60;
    scrollRef.current.scrollTop = Math.max(0, (targetMinutes / 60) * HOUR_HEIGHT);
  }, [isToday]);

  // 60s tick drives the red "now" line + the ended-event greying.
  // Same cadence + helper as the canonical DayView so we don't drift.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const stepDay = useCallback((dir: -1 | 1) => {
    setAnchor((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + dir);
      return next;
    });
  }, []);

  const goToToday = useCallback(() => {
    setAnchor(new Date());
  }, []);

  const heading = anchor.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const isLoading = nativeLoading || externalLoading;
  const hasFeedErrors = errorsByFeedId.size > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header strip: day label + nav arrows + Today reset + Open full
          calendar CTA. Sticky-ish at the top of the popup body. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-1">
          <Tooltip label="Previous day" placement="bottom">
            <button
              type="button"
              onClick={() => stepDay(-1)}
              aria-label="Previous day"
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              {CHEVRON_LEFT_SVG}
            </button>
          </Tooltip>
          <Tooltip label="Next day" placement="bottom">
            <button
              type="button"
              onClick={() => stepDay(1)}
              aria-label="Next day"
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              {CHEVRON_RIGHT_SVG}
            </button>
          </Tooltip>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 min-w-0">
          {heading}
        </h3>
        {isToday ? (
          <span className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold px-1.5 py-0.5 rounded bg-blue-50">
            Today
          </span>
        ) : (
          <button
            type="button"
            onClick={goToToday}
            className="text-[11px] text-blue-600 hover:underline"
          >
            Jump to today
          </button>
        )}
        <div className="flex-1" />
        <Link
          href="/calendar"
          onClick={() => closePopup()}
          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
        >
          Open full calendar
          <span aria-hidden="true">{EXTERNAL_LINK_SVG}</span>
        </Link>
      </div>

      {/* Loading state: keep the chrome rendered so the user doesn't
          see the popup body collapse to a single line on first paint. */}
      {isLoading && items.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Loading...</p>
      ) : null}

      {/* Per-feed error surface, mirrors the warning bar on /calendar. */}
      {hasFeedErrors && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <p className="font-medium">
            Some linked calendars could not be fetched. Open the full
            calendar to retry.
          </p>
        </div>
      )}

      {/* All-day strip, only when populated, mirroring the full DayView
          so the visual rhythm matches users' expectations. */}
      {sortedAllDay.length > 0 && (
        <div className="flex-shrink-0 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
            All-day
          </p>
          <div className="space-y-1">
            {sortedAllDay.map((item) => {
              const ended = hasEnded(item.event, now);
              const itemColor =
                item.kind === "native"
                  ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
                  : item.event.color;
              const textColor = getReadableTextColor(itemColor);
              const key =
                item.kind === "native"
                  ? `n-${item.event.id}`
                  : `x-${item.event.id}`;
              return (
                <div
                  key={key}
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${ended ? ENDED_CLASSES : ""}`}
                  style={{
                    backgroundColor: itemColor,
                    color: textColor,
                    border: item.kind === "external" ? `1px solid ${itemColor}` : "none",
                  }}
                  title={item.event.title}
                >
                  {item.kind === "external" && (
                    <span aria-hidden="true">{EXTERNAL_CHAIN_SVG}</span>
                  )}
                  {item.event.start_time && (
                    <span className="font-semibold flex-shrink-0">
                      {formatTime(item.event.start_time)}
                    </span>
                  )}
                  <span className="truncate">{item.event.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty-day cue when there is genuinely nothing on the day. We
          keep the day header + nav arrows up top so users can still
          step to a neighbouring day. */}
      {!isLoading && items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-gray-400">
          <span aria-hidden="true">{EMPTY_TEA_SVG}</span>
          <p className="text-xs italic">No events on this day</p>
        </div>
      ) : (
        /* Time grid: 24-hour ladder + positioned event blocks. The
            outer flex-1 + min-h-0 + overflow-y-auto pattern lets the
            grid scroll inside the popup body without growing the
            popup itself. */
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto rounded-md border border-gray-100"
        >
          <div
            className="grid grid-cols-[64px_1fr] relative"
            style={{ height: TOTAL_HEIGHT }}
          >
            {/* Hour labels */}
            <div className="relative">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="border-t border-gray-100 text-[11px] text-gray-400 text-right pr-2 pt-0.5"
                  style={{ height: HOUR_HEIGHT }}
                >
                  {h === 0
                    ? ""
                    : h === 12
                    ? "12pm"
                    : h > 12
                    ? `${h - 12}pm`
                    : `${h}am`}
                </div>
              ))}
            </div>

            {/* Day column. Clicks are intentionally not bound to a
                create-event affordance here (the popup is read-only;
                creating events lives on /calendar). */}
            <div className="relative border-l border-gray-100">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="border-t border-gray-100 pointer-events-none"
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}

              {isToday && (
                <div
                  className="absolute left-0 right-0 pointer-events-none z-10"
                  style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                >
                  <div className="h-[2px] bg-red-500" />
                  <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                </div>
              )}

              {laneAssignments.map(({ item, lane, laneCount }) => {
                const start = timeToMinutes(item.event.start_time) ?? 0;
                const end = timeToMinutes(item.event.end_time) ?? start + 30;
                const top = (start / 60) * HOUR_HEIGHT;
                const height = Math.max(
                  ((Math.max(end, start + 15) - start) / 60) * HOUR_HEIGHT,
                  20,
                );
                const widthPct = 100 / laneCount;
                const leftPct = lane * widthPct;
                const color =
                  item.kind === "native"
                    ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
                    : item.event.color;
                const ended = hasEnded(item.event, now);
                const textColor = getReadableTextColor(color);
                const key =
                  item.kind === "native"
                    ? `n-${item.event.id}`
                    : `x-${item.event.id}`;

                return (
                  <div
                    key={key}
                    className={`absolute rounded-md px-2 py-1 overflow-hidden z-10 ${ended ? ENDED_CLASSES : ""}`}
                    style={{
                      top,
                      height: height - 1,
                      left: `calc(${leftPct}% + 4px)`,
                      width: `calc(${widthPct}% - 8px)`,
                      backgroundColor: color,
                      color: textColor,
                      border: item.kind === "external" ? `1px solid ${color}` : "none",
                    }}
                    title={item.event.title}
                  >
                    <p className="text-[11px] font-medium truncate flex items-center gap-1">
                      {item.kind === "external" && (
                        <span aria-hidden="true">{EXTERNAL_CHAIN_SVG}</span>
                      )}
                      <span className="truncate">{item.event.title}</span>
                    </p>
                    <p className="text-[10px] opacity-80 truncate">
                      {formatTime(item.event.start_time)}
                      {item.event.end_time && ` - ${formatTime(item.event.end_time)}`}
                    </p>
                    {item.event.location && height > 44 && (
                      <p className="text-[10px] opacity-70 truncate">
                        {item.event.location}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tool registry alias: `lib/lab-overview/tool-registry.tsx` imports
 *  the popup body as `ExpandedView`, so a name match here keeps the
 *  registry import line uniform with the other widget files. */
export const ExpandedView = CalendarDayPopupView;

// ── FOLLOW-UPs ───────────────────────────────────────────────────────────
//
// 1. usePopupActions().closePopup() — wrap the "Open full calendar"
//    Link onClick once the popup-close hook lands in
//    `lib/lab-overview/popup-actions.tsx`. One-line reconcile.
//
// 2. Event detail popover — clicking an event currently does nothing.
//    Wiring through to the existing EventModal / ExternalEventModal
//    would let the popup body fully replace /calendar for the
//    quick-glance use case. Those modals live in /calendar/page.tsx
//    and would need a small extraction before they can be reused
//    here.
//
// 3. Multi-day view in popup — Grant may eventually want a 3-day
//    timeline (today + flanking days) inside the popup, since the
//    body is wide enough at max-w-5xl. Hold off until a user surfaces
//    the need; the single-day view covers the "what's on my plate
//    for X day" question.
