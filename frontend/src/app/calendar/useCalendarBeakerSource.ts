// sequence editor master (Calendar source sub-bot). BeakerSearch step 3, the
// thin HOOK that wires the live Calendar page state + handlers into the pure
// buildCalendarSource builder and registers the result with the shared palette.
//
// All the testable logic lives in calendar-beaker-source.ts (no React, no
// store). This hook takes the page's REAL state + handlers (the live
// currentDate, the selection setters, openCreateAt / stepDate / setView / the
// day-drawer + feeds openers) straight from CalendarPage, reads the same shared
// queries the page reads (the ["events"] query, useCalendarFeeds,
// useExternalEvents), formats the visible frame the way the page's headingLabel
// does, keeps a small last-selected ref so SELECTED survives the detail modal
// closing, closes the thin eventsApi + syncEventPtoChange mutating helpers, and
// calls buildCalendarSource inside a useMemo so the registration object is
// stable.
//
// The PTO toggle reuses expandDateRange + syncEventPtoChange and gates on
// currentUser, EXACTLY as the page's onSave / onCreate / delete paths do. It
// never writes pto_dates directly.
//
// Note on the jump-to-date nicety (spec 4): the generic BeakerSearchSource
// contract feeds the palette static navGroups (no query-time callback), so a
// "Go to {typed date}" row that reacts to the live query string cannot be built
// purely from this source. It needs a query-aware seam in the palette itself
// (the parseCalendarDate module the spec sketches), which is OUT OF SCOPE for
// this per-page source. The handler `goToDate` is wired and ready, so when that
// seam lands the date item is a one-line addition. Everything else in the spec
// is shipped.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAppStore } from "@/lib/store";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import {
  type CalendarView,
  eventCoversDate,
  eventTimeOrder,
  formatTime,
  toLocalDateString,
} from "@/components/calendar/utils";
import {
  useCalendarFeeds,
  useExternalEvents,
} from "@/lib/calendar/use-external-events";
import {
  expandDateRange,
  syncEventPtoChange,
} from "@/lib/streak/calendar-pto-sync";
import type { CalendarFeed, Event, ExternalEvent } from "@/lib/types";
import {
  buildCalendarSource,
  type CalendarFrame,
  type CalendarSourceData,
  type CalendarSourceHandlers,
  type CalendarUpcomingItem,
} from "./calendar-beaker-source";

// How many upcoming events the "Next up" group shows (spec 5).
const UPCOMING_CAP = 5;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The page's live state + handlers, passed straight into the hook so the
 *  palette drives the exact same flows the page's own buttons do. CalendarPage
 *  owns currentDate / the selection / the modal plumbing, so it hands them in
 *  rather than the hook re-deriving them. */
export interface CalendarBeakerPageDeps {
  view: CalendarView;
  currentDate: Date;
  /** The page's live native-event selection (the open detail modal), so the
   *  palette echoes it and survives the modal closing via a last-selected ref. */
  selectedEvent: Event | null;
  /** The page's live external-event selection (the read-only detail modal). */
  selectedExternal: ExternalEvent | null;
  setView: (v: CalendarView) => void;
  setCurrentDate: (d: Date) => void;
  goToToday: () => void;
  stepDate: (dir: -1 | 1) => void;
  openCreate: () => void;
  openCreateAt: (dateStr: string, startTime: string | null) => void;
  openDayView: (dateStr: string) => void;
  setExpandedDate: (dateStr: string) => void;
  setSelectedEvent: (e: Event | null) => void;
  setSelectedExternal: (e: ExternalEvent | null) => void;
  setEditingEvent: (e: Event | null) => void;
  setDeleteConfirmEvent: (e: Event | null) => void;
  /** Open the linked-calendars modal (the page deep-links it via ?addFeed=1). */
  openFeeds: () => void;
  /** Add-feed entry (same deep-link CalendarFeedsButton honors). */
  addFeed: () => void;
}

/** A "Mon D" short label for a local YYYY-MM-DD string, no Date(string) on free
 *  text (we split the strict shape ourselves). */
function shortLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** The Sunday-start 7 days for the week containing `anchor`, as YYYY-MM-DD. */
function weekDayStrings(anchor: Date): string[] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toLocalDateString(d);
  });
}

/** Every visible YYYY-MM-DD for the current frame (month -> the calendar month,
 *  week -> the 7 days, day -> the single day). Used to count on-screen events
 *  and to scope the empty-query jump list. The month uses the calendar month
 *  (spec 2.2 "user-meaningful range"), not the 42-cell span. */
function frameDateStrings(view: CalendarView, currentDate: Date): string[] {
  if (view === "day") return [toLocalDateString(currentDate)];
  if (view === "week") return weekDayStrings(currentDate);
  // month, every day of the calendar month.
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) =>
    toLocalDateString(new Date(year, month, i + 1)),
  );
}

/** A single event's date line, matching the detail modals (start, optional end,
 *  optional time). */
function eventDateLine(e: Event | ExternalEvent): string {
  const start = shortLabel(e.start_date);
  let line = start;
  if (e.end_date && e.end_date !== e.start_date) {
    line = `${start} to ${shortLabel(e.end_date)}`;
  }
  if (e.start_time) {
    line += `, ${formatTime(e.start_time)}`;
    if (e.end_time) line += ` to ${formatTime(e.end_time)}`;
  }
  return line;
}

/** Whole-days difference between two local YYYY-MM-DD strings (b - a). */
function daysBetween(aStr: string, bStr: string): number {
  const [ay, am, ad] = aStr.split("-").map(Number);
  const [by, bm, bd] = bStr.split("-").map(Number);
  const a = new Date(ay, am - 1, ad).getTime();
  const b = new Date(by, bm - 1, bd).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/** The "Next up" subtitle, relative + absolute ("in 2 days, Jun 9"). */
function upcomingDetail(todayStr: string, item: CalendarUpcomingItem): string {
  const start = item.event.start_date;
  const diff = daysBetween(todayStr, start);
  const rel =
    diff <= 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
  return `${rel}, ${shortLabel(start)}`;
}

/** Build the human frame the context card + the navigate commands read from. */
function buildFrame(
  view: CalendarView,
  currentDate: Date,
  eventCount: number,
): CalendarFrame {
  const todayStr = toLocalDateString(new Date());
  const focusedDateStr = toLocalDateString(currentDate);
  const days = frameDateStrings(view, currentDate);
  const evWord = eventCount === 1 ? "event" : "events";

  let title: string;
  let meta: string;
  let unitNoun: string;
  let frameLabel: string;

  if (view === "month") {
    title = `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    meta = `${days.length} days in view, ${eventCount} ${evWord}`;
    unitNoun = "month";
    frameLabel = title;
  } else if (view === "week") {
    title = `week of ${shortLabel(days[0])}`;
    meta = `${shortLabel(days[0])} to ${shortLabel(days[6])}, ${eventCount} ${evWord}`;
    unitNoun = "week";
    frameLabel = "this week";
  } else {
    title = currentDate.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    meta = `${eventCount} ${evWord} ${eventCount === 1 ? "on this day" : "in view"}`;
    unitNoun = "day";
    frameLabel = "today";
  }

  return {
    view,
    title,
    meta,
    unitNoun,
    focusedDateStr,
    todayStr,
    isOnToday: focusedDateStr === todayStr,
    frameLabel,
  };
}

/** Register the Calendar page's BeakerSearch source while the page is mounted.
 *  Call once from app/calendar/page.tsx after the existing hooks, handing in the
 *  page's live state + handlers. */
export function useCalendarBeakerSource(deps: CalendarBeakerPageDeps): void {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const offlineMode = useAppStore((s) => s.offlineMode);

  // Shared queries (same keys the page reads, so no extra fetch).
  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: eventsApi.list,
  });
  const { data: feeds = [] } = useCalendarFeeds();
  const {
    events: externalEvents,
    errorsByFeedId: externalErrors,
    refetch: refetchExternal,
  } = useExternalEvents();

  const {
    view,
    currentDate,
    selectedEvent,
    selectedExternal,
    setView,
    setCurrentDate,
    goToToday,
    stepDate,
    openCreate,
    openCreateAt,
    openDayView,
    setExpandedDate,
    setSelectedEvent: pageSetSelectedEvent,
    setSelectedExternal: pageSetSelectedExternal,
    setEditingEvent,
    setDeleteConfirmEvent,
    openFeeds,
    addFeed,
  } = deps;

  // Last-selected event so SELECTED survives the detail modal closing (spec
  // 2.5). The page owns the live selectedEvent / selectedExternal; we track the
  // most recent non-null one (whether set by a click or by the palette) so
  // "Edit the event I just looked at" still works after the modal closes. A
  // native selection clears the external one and vice versa.
  const lastSelectedEventRef = useRef<Event | null>(null);
  const lastSelectedExternalRef = useRef<ExternalEvent | null>(null);
  if (selectedEvent) {
    lastSelectedEventRef.current = selectedEvent;
    lastSelectedExternalRef.current = null;
  } else if (selectedExternal) {
    lastSelectedExternalRef.current = selectedExternal;
    lastSelectedEventRef.current = null;
  }

  // Jump-to-date drives the page's anchor directly (in-page state, no URL
  // history spam, matching the sidebar jumpTo). The local YYYY-MM-DD is parsed
  // by splitting the strict shape, never via new Date(freeText).
  const goToDate = useCallback(
    (dateStr: string) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      if (!y || !m || !d) return;
      setCurrentDate(new Date(y, m - 1, d));
    },
    [setCurrentDate],
  );

  // The live-selection refs above already track the last non-null selection, so
  // these wrappers just forward to the page setters (the ref update happens on
  // the next render when the page's selectedEvent / selectedExternal flows in).
  const setSelectedEvent = pageSetSelectedEvent;
  const setSelectedExternal = pageSetSelectedExternal;

  // The thin mutating helpers, reusing the page's exact flow (spec 7).
  const duplicateEvent = useCallback(
    async (e: Event) => {
      const { id: _id, ...rest } = e;
      await eventsApi.create({ ...rest, title: `${e.title} (copy)` });
      await queryClient.refetchQueries({ queryKey: ["events"] });
    },
    [queryClient],
  );

  const markEventPto = useCallback(
    async (e: Event, on: boolean) => {
      const prevIsPto = e.is_pto === true;
      const dates = expandDateRange(e.start_date, e.end_date);
      await eventsApi.update(e.id, { is_pto: on });
      await queryClient.refetchQueries({ queryKey: ["events"] });
      // Mirror into pto_dates via the streak sync, never writing it directly.
      if (currentUser && (prevIsPto || on)) {
        void syncEventPtoChange(
          currentUser,
          { isPto: prevIsPto, dates: prevIsPto ? dates : [] },
          { isPto: on, dates: on ? dates : [] },
        );
      }
    },
    [queryClient, currentUser],
  );

  const handlers = useMemo<CalendarSourceHandlers>(
    () => ({
      setEditingEvent,
      setSelectedEvent,
      setSelectedExternal,
      setDeleteConfirmEvent,
      duplicateEvent,
      markEventPto,
      openCreate,
      openCreateAt,
      goToToday,
      stepDate,
      goToDate,
      openDayView,
      setExpandedDate,
      setView,
      openFeeds,
      addFeed,
      retryExternal: () => void refetchExternal(),
    }),
    [
      setEditingEvent,
      setSelectedEvent,
      setSelectedExternal,
      setDeleteConfirmEvent,
      duplicateEvent,
      markEventPto,
      openCreate,
      openCreateAt,
      goToToday,
      stepDate,
      goToDate,
      openDayView,
      setExpandedDate,
      setView,
      openFeeds,
      addFeed,
      refetchExternal,
    ],
  );

  // The feed-of-external lookup, captured once over the live feeds.
  const feedById = useMemo(() => {
    const map = new Map<number, CalendarFeed>();
    for (const f of feeds) map.set(f.id, f);
    return map;
  }, [feeds]);

  // On-screen events (native + external), filtered to the visible frame, the
  // same eventCoversDate test the views and the day drawer use.
  const onScreenEvents = useMemo<Event[]>(() => {
    const days = frameDateStrings(view, currentDate);
    return events.filter((e) => days.some((d) => eventCoversDate(e, d)));
  }, [events, view, currentDate]);

  const onScreenExternalEvents = useMemo<ExternalEvent[]>(() => {
    const days = frameDateStrings(view, currentDate);
    return externalEvents.filter((e) => days.some((d) => eventCoversDate(e, d)));
  }, [externalEvents, view, currentDate]);

  const eventCount = onScreenEvents.length + onScreenExternalEvents.length;

  // Upcoming events (start_date >= today), native + external, sorted by
  // (start_date, start_time) using eventTimeOrder for the time tiebreak, capped.
  const upcomingEvents = useMemo<CalendarUpcomingItem[]>(() => {
    const todayStr = toLocalDateString(new Date());
    const items: CalendarUpcomingItem[] = [
      ...events
        .filter((e) => e.start_date >= todayStr)
        .map((e) => ({ kind: "native" as const, event: e })),
      ...externalEvents
        .filter((e) => e.start_date >= todayStr)
        .map((e) => ({ kind: "external" as const, event: e })),
    ];
    items.sort((a, b) => {
      if (a.event.start_date !== b.event.start_date) {
        return a.event.start_date < b.event.start_date ? -1 : 1;
      }
      return eventTimeOrder(a.event, b.event);
    });
    return items.slice(0, UPCOMING_CAP);
  }, [events, externalEvents]);

  const frame = useMemo(
    () => buildFrame(view, currentDate, eventCount),
    [view, currentDate, eventCount],
  );

  const source = useMemo(() => {
    const data: CalendarSourceData = {
      events,
      externalEvents,
      feeds,
      enabledFeedCount: feeds.filter((f) => f.enabled).length,
      externalErrorsCount: externalErrors.size,
      offlineMode,
      frame,
      onScreenEvents,
      onScreenExternalEvents,
      selectedEvent: lastSelectedEventRef.current,
      selectedExternal: lastSelectedExternalRef.current,
      upcomingEvents,
      eventDateLine,
      upcomingDetail: (item) => upcomingDetail(frame.todayStr, item),
      feedOfExternal: (e) => feedById.get(e.feedId) ?? null,
    };
    return buildCalendarSource(data, handlers);
  }, [
    events,
    externalEvents,
    feeds,
    externalErrors,
    offlineMode,
    frame,
    onScreenEvents,
    onScreenExternalEvents,
    upcomingEvents,
    feedById,
    handlers,
    // The live selection drives the context card + Suggested set; recompute the
    // source whenever it changes (the refs are updated above from these).
    selectedEvent,
    selectedExternal,
  ]);

  useBeakerSearchSource(source);
}
