"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/local-api";
import { useAppStore } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import AppShell from "@/components/AppShell";
import CalendarFeedsButton from "@/components/CalendarFeedsButton";
import DayDetailDrawer from "@/components/DayDetailDrawer";
import Tooltip from "@/components/Tooltip";
import MonthView from "@/components/calendar/MonthView";
import WeekView from "@/components/calendar/WeekView";
import DayView from "@/components/calendar/DayView";
import {
  type CalendarView,
  formatTime,
  EVENT_TYPE_COLORS,
} from "@/components/calendar/utils";
import {
  useCalendarFeeds,
  useExternalEvents,
} from "@/lib/calendar/use-external-events";
import { useCalendarNavStore } from "@/lib/calendar/calendar-nav-store";
import {
  expandDateRange,
  syncEventPtoChange,
} from "@/lib/streak/calendar-pto-sync";
import type { CalendarFeed, Event, ExternalEvent } from "@/lib/types";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

export default function CalendarPage() {
  const queryClient = useQueryClient();
  // Active user, needed for the Phase S5 PTO sync from a checked event
  // to the user's pto_dates list (see syncEventPtoChange below).
  const { currentUser } = useCurrentUser();
  // View mode comes from the user's settings.json via Zustand; in-session
  // changes update the store but don't write back to disk (use Settings →
  // Defaults to change the persisted default).
  const view: CalendarView = useAppStore((s) => s.calendarViewMode);
  const setView = useAppStore((s) => s.setCalendarViewMode);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [deleteConfirmEvent, setDeleteConfirmEvent] = useState<Event | null>(null);
  const [prefilledStartDate, setPrefilledStartDate] = useState<string | null>(null);
  const [prefilledStartTime, setPrefilledStartTime] = useState<string | null>(null);

  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: eventsApi.list,
  });

  const { data: feeds = [] } = useCalendarFeeds();
  const {
    events: externalEvents,
    errorsByFeedId: externalErrors,
    isFetching: externalIsFetching,
    refetch: refetchExternal,
  } = useExternalEvents();

  const [selectedExternal, setSelectedExternal] = useState<ExternalEvent | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  // View-aware navigation: prev/next steps by month / week / day depending
  // on the active view, so the controls feel native in each.
  const stepDate = useCallback(
    (dir: -1 | 1) => {
      setCurrentDate((prev) => {
        const next = new Date(prev);
        if (view === "month") {
          next.setDate(1);
          next.setMonth(next.getMonth() + dir);
        } else if (view === "week") {
          next.setDate(next.getDate() + 7 * dir);
        } else {
          next.setDate(next.getDate() + dir);
        }
        return next;
      });
    },
    [view]
  );

  const goToToday = useCallback(() => setCurrentDate(new Date()), []);

  // React to navigation requests from the sidebar (clicking an upcoming
  // event). Subscribed via zustand directly rather than via a selector +
  // effect so we don't trigger a render cycle every time another piece of
  // the page re-renders.
  useEffect(() => {
    const apply = (jump: { view: CalendarView; dateStr: string } | null) => {
      if (!jump) return;
      setView(jump.view);
      const [yy, mm, dd] = jump.dateStr.split("-").map(Number);
      setCurrentDate(new Date(yy, mm - 1, dd));
      useCalendarNavStore.getState().clearJump();
    };
    apply(useCalendarNavStore.getState().pendingJump);
    return useCalendarNavStore.subscribe((state) => apply(state.pendingJump));
  }, [setView, setCurrentDate]);

  const openCreateAt = useCallback((dateStr: string, startTime: string | null) => {
    setPrefilledStartDate(dateStr);
    setPrefilledStartTime(startTime);
    setCreating(true);
  }, []);

  const openDayView = useCallback((dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    setCurrentDate(new Date(y, m - 1, d));
    setView("day");
  }, [setView]);

  // Heading label depends on view
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const headingLabel = (() => {
    if (view === "month") {
      return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }
    if (view === "week") {
      const start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const sameYear = start.getFullYear() === end.getFullYear();
      const startStr = start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const endStr = end.toLocaleDateString(undefined, {
        month: sameMonth ? undefined : "short",
        day: "numeric",
        year: sameYear ? undefined : "numeric",
      });
      return `${startStr} – ${endStr}${sameYear ? `, ${start.getFullYear()}` : ""}`;
    }
    return currentDate.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  })();


  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Calendar</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Conferences, deadlines, and events
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CalendarFeedsButton />
            <button
              onClick={() => setCreating(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Event
            </button>
          </div>
        </div>

        {externalErrors.size > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <p className="font-medium mb-1">
              Some linked calendars couldn&apos;t be fetched:
            </p>
            <ul className="list-disc list-inside space-y-0.5">
              {Array.from(externalErrors.entries()).map(([feedId, msg]) => (
                <li key={feedId}>{msg}</li>
              ))}
            </ul>
            <button
              onClick={() => void refetchExternal()}
              disabled={externalIsFetching}
              className="mt-2 text-amber-700 underline disabled:opacity-50"
            >
              {externalIsFetching ? "Retrying…" : "Retry now"}
            </button>
          </div>
        )}

        {/* Navigation + view switcher */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tooltip label={`Previous ${view}`} placement="bottom">
              <button
                onClick={() => stepDate(-1)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </Tooltip>
            <h3 className="text-lg font-semibold text-gray-900 min-w-[180px]">
              {headingLabel}
            </h3>
            <Tooltip label={`Next ${view}`} placement="bottom">
              <button
                onClick={() => stepDate(1)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </Tooltip>
            <button
              onClick={goToToday}
              className="ml-2 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              Today
            </button>
          </div>
          <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
            {(["month", "week", "day"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                  view === v
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Active view */}
        {view === "month" && (
          <MonthView
            anchor={currentDate}
            events={events}
            externalEvents={externalEvents}
            onDayClick={(dateStr) => setExpandedDate(dateStr)}
            onDayDoubleClick={(dateStr) => openCreateAt(dateStr, null)}
            onEventClick={setSelectedEvent}
            onExternalClick={setSelectedExternal}
          />
        )}
        {view === "week" && (
          <WeekView
            anchor={currentDate}
            events={events}
            externalEvents={externalEvents}
            onDayHeaderClick={openDayView}
            onEventClick={setSelectedEvent}
            onExternalClick={setSelectedExternal}
            onCreateAt={openCreateAt}
          />
        )}
        {view === "day" && (
          <DayView
            anchor={currentDate}
            events={events}
            externalEvents={externalEvents}
            onEventClick={setSelectedEvent}
            onExternalClick={setSelectedExternal}
            onCreateAt={openCreateAt}
          />
        )}

      </div>

      {/* Event Detail/Edit Modal */}
      {(selectedEvent || editingEvent) && (
        <EventModal
          event={(selectedEvent || editingEvent)!}
          isEditing={!!editingEvent}
          onClose={() => {
            setSelectedEvent(null);
            setEditingEvent(null);
          }}
          onEdit={() => {
            setEditingEvent(selectedEvent);
            setSelectedEvent(null);
          }}
          onDelete={() => {
            if (!selectedEvent) return;
            setDeleteConfirmEvent(selectedEvent);
          }}
          onSave={async (data) => {
            if (!editingEvent) return;
            try {
              // Snapshot the prev PTO state from the event that's open in
              // the editor (its dates may have been edited; we use the
              // original `editingEvent` dates for the "remove" side).
              const prevIsPto = editingEvent.is_pto === true;
              const prevDates = prevIsPto
                ? expandDateRange(
                    editingEvent.start_date,
                    editingEvent.end_date,
                  )
                : [];
              await eventsApi.update(editingEvent.id, data);
              await queryClient.refetchQueries({ queryKey: ["events"] });
              const nextIsPto = data.is_pto === true;
              const nextStart = data.start_date ?? editingEvent.start_date;
              const nextEnd =
                data.end_date === undefined
                  ? editingEvent.end_date
                  : data.end_date;
              const nextDates = nextIsPto
                ? expandDateRange(nextStart, nextEnd)
                : [];
              if (currentUser && (prevIsPto || nextIsPto)) {
                void syncEventPtoChange(
                  currentUser,
                  { isPto: prevIsPto, dates: prevDates },
                  { isPto: nextIsPto, dates: nextDates },
                );
              }
              setEditingEvent(null);
            } catch {
              alert("Failed to update event");
            }
          }}
        />
      )}

      {/* Day-detail drawer (single click on a day cell) */}
      {expandedDate && (
        <DayDetailDrawer
          dateStr={expandedDate}
          events={events.filter((e) => {
            const start = e.start_date;
            const end = e.end_date || e.start_date;
            return expandedDate >= start && expandedDate <= end;
          })}
          externalEvents={externalEvents.filter((e) => {
            const start = e.start_date;
            const end = e.end_date || e.start_date;
            return expandedDate >= start && expandedDate <= end;
          })}
          onClose={() => setExpandedDate(null)}
          onSelectNative={(e) => {
            setExpandedDate(null);
            setSelectedEvent(e);
          }}
          onSelectExternal={(e) => {
            setExpandedDate(null);
            setSelectedExternal(e);
          }}
          onCreate={(d) => {
            setExpandedDate(null);
            setPrefilledStartDate(d);
            setCreating(true);
          }}
        />
      )}

      {/* External Event Modal — read-only (ICS subscriptions can't be edited) */}
      {selectedExternal && (
        <ExternalEventModal
          event={selectedExternal}
          feed={feeds.find((f) => f.id === selectedExternal.feedId) ?? null}
          onClose={() => setSelectedExternal(null)}
        />
      )}

      {/* Create Event Modal */}
      {creating && (
        <CreateEventModal
          defaultStartDate={prefilledStartDate || undefined}
          defaultStartTime={prefilledStartTime || undefined}
          onClose={() => {
            setCreating(false);
            setPrefilledStartDate(null);
            setPrefilledStartTime(null);
          }}
          onCreate={async (data) => {
            try {
              await eventsApi.create({
                title: data.title!,
                event_type: data.event_type || "other",
                start_date: data.start_date!,
                end_date: data.end_date,
                start_time: data.start_time,
                end_time: data.end_time,
                location: data.location,
                url: data.url,
                notes: data.notes,
                color: data.color,
                is_pto: data.is_pto ?? null,
              });
              await queryClient.refetchQueries({ queryKey: ["events"] });
              // Mirror the PTO flag into the user's pto_dates list. New
              // event => prev=null. syncEventPtoChange is a no-op when
              // is_pto is false.
              if (currentUser && data.is_pto === true) {
                const dates = expandDateRange(
                  data.start_date as string,
                  data.end_date ?? null,
                );
                void syncEventPtoChange(
                  currentUser,
                  null,
                  { isPto: true, dates },
                );
              }
              setCreating(false);
              setPrefilledStartDate(null);
              setPrefilledStartTime(null);
            } catch {
              alert("Failed to create event");
            }
          }}
        />
      )}

      {/* Delete Confirmation Dialog (P0-2: replaces window.confirm) */}
      {deleteConfirmEvent && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
          onClick={() => setDeleteConfirmEvent(null)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Delete Event?
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              &ldquo;{deleteConfirmEvent.title}&rdquo; will be permanently deleted. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmEvent(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ev = deleteConfirmEvent;
                  setDeleteConfirmEvent(null);
                  try {
                    const prevIsPto = ev.is_pto === true;
                    const prevDates = prevIsPto
                      ? expandDateRange(ev.start_date, ev.end_date)
                      : [];
                    await eventsApi.delete(ev.id);
                    await queryClient.refetchQueries({ queryKey: ["events"] });
                    if (currentUser && prevIsPto) {
                      void syncEventPtoChange(
                        currentUser,
                        { isPto: true, dates: prevDates },
                        null,
                      );
                    }
                    setSelectedEvent(null);
                  } catch {
                    alert("Failed to delete event");
                  }
                }}
                className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ── Event Modal ───────────────────────────────────────────────────────────────

function EventModal({
  event,
  isEditing,
  onClose,
  onEdit,
  onDelete,
  onSave,
}: {
  event: Event;
  isEditing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSave: (data: Partial<Event>) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [eventType, setEventType] = useState(event.event_type);
  const [startDate, setStartDate] = useState(event.start_date);
  const [endDate, setEndDate] = useState(event.end_date || "");
  const [startTime, setStartTime] = useState(event.start_time || "");
  const [endTime, setEndTime] = useState(event.end_time || "");
  const [location, setLocation] = useState(event.location || "");
  const [url, setUrl] = useState(event.url || "");
  const [notes, setNotes] = useState(event.notes || "");
  const [color, setColor] = useState(event.color || "");
  // Phase S5 PTO sync: this checkbox writes the event's date(s) into the
  // user's pto_dates list when on, removes them when off. Stored on the
  // event record as `is_pto` so the box survives reopen.
  const [isPto, setIsPto] = useState<boolean>(event.is_pto === true);
  // P1-6: end-before-start validation
  const [endTimeTouched, setEndTimeTouched] = useState(false);
  const endBeforeStart =
    !!startTime && !!endTime && endTime < startTime;

  // P1-3: Escape key closes the modal
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSave = () => {
    if (endBeforeStart) return;
    onSave({
      title,
      event_type: eventType,
      start_date: startDate,
      end_date: endDate || null,
      start_time: startTime || null,
      end_time: endTime || null,
      location: location || null,
      url: url || null,
      notes: notes || null,
      color: color || null,
      is_pto: isPto,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      {/* P0-1: modal shell uses flex-col + max-h so header/footer stay fixed and body scrolls */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-details-title"
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 flex flex-col max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 id="event-details-title" className="text-base font-semibold text-gray-900">
            {isEditing ? "Edit Event" : "Event Details"}
          </h3>
          <Tooltip label="Close" placement="bottom">
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as Event["event_type"])}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="conference">Conference</option>
                  <option value="deadline">Deadline</option>
                  <option value="meeting">Meeting</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Start Time <span className="text-gray-300 font-normal">(optional)</span>
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    End Time <span className="text-gray-300 font-normal">(optional)</span>
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => {
                      setEndTime(e.target.value);
                      setEndTimeTouched(true);
                    }}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      endTimeTouched && endBeforeStart
                        ? "border-red-400"
                        : "border-gray-200"
                    }`}
                  />
                  {/* P1-6: inline error shown after user has interacted with end time */}
                  {endTimeTouched && endBeforeStart && (
                    <p className="mt-1 text-xs text-red-500">
                      End time must be after start time.
                    </p>
                  )}
                </div>
              </div>
              {(startTime || endTime) && (
                <button
                  type="button"
                  onClick={() => {
                    setStartTime("");
                    setEndTime("");
                    setEndTimeTouched(false);
                  }}
                  className="text-[11px] text-blue-600 hover:underline -mt-2"
                >
                  Clear times (make all-day)
                </button>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
                <div className="flex gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <Tooltip key={c} label={`Use color ${c}`} placement="bottom">
                      <button
                        onClick={() => setColor(c)}
                        aria-label={`Use color ${c}`}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    </Tooltip>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPto}
                    onChange={(e) => setIsPto(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-400"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-gray-700">
                      Mark as PTO day
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      This day will be treated like a weekend for streaks and
                      project schedules.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 text-xs rounded-full text-white"
                  style={{ backgroundColor: event.color || EVENT_TYPE_COLORS[event.event_type] }}
                >
                  {event.event_type}
                </span>
                {event.is_pto === true && (
                  <Tooltip
                    label="PTO day, won't break your streak"
                    placement="bottom"
                  >
                    <span className="px-2 py-0.5 text-xs rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-medium">
                      PTO
                    </span>
                  </Tooltip>
                )}
              </div>
              <h4 className="text-lg font-semibold text-gray-900">{event.title}</h4>
              <p className="text-sm text-gray-600">
                {event.start_date}
                {event.end_date && event.end_date !== event.start_date && (
                  <> → {event.end_date}</>
                )}
                {event.start_time && (
                  <>
                    {" · "}
                    {formatTime(event.start_time)}
                    {event.end_time && <> – {formatTime(event.end_time)}</>}
                  </>
                )}
              </p>
              {event.location && (
                <p className="text-sm text-gray-600">Location: {event.location}</p>
              )}
              {event.url && (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  {event.url}
                </a>
              )}
              {event.notes && (
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{event.notes}</p>
              )}
            </div>
          )}
        </div>
        {/* P0-1: footer stays pinned at bottom (flex-shrink-0 on parent flex-col) */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
          {isEditing ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              {/* P1-6: disabled when end time is before start time */}
              <button
                onClick={handleSave}
                disabled={endBeforeStart}
                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </>
          ) : (
            <>
              <button onClick={onDelete} className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg">
                Delete
              </button>
              <button onClick={onEdit} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                Edit
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Create Event Modal ────────────────────────────────────────────────────────

function CreateEventModal({
  onClose,
  onCreate,
  defaultStartDate,
  defaultStartTime,
}: {
  onClose: () => void;
  onCreate: (data: Partial<Event>) => void;
  defaultStartDate?: string;
  defaultStartTime?: string;
}) {
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<Event["event_type"]>("conference");
  // Use local date to avoid timezone issues
  const getLocalDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [startDate, setStartDate] = useState(defaultStartDate || getLocalDateString());
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState(defaultStartTime || "");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [color, setColor] = useState("");
  const [isPto, setIsPto] = useState<boolean>(false);

  // P1-3: Escape key closes the modal
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleCreate = () => {
    if (!title.trim()) return;
    onCreate({
      title,
      event_type: eventType,
      start_date: startDate,
      end_date: endDate || null,
      start_time: startTime || null,
      end_time: endTime || null,
      location: location || null,
      url: url || null,
      notes: notes || null,
      color: color || null,
      is_pto: isPto,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      {/* P0-1: flex-col + max-h keeps header/footer fixed while body scrolls */}
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 flex flex-col max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-900">New Event</h3>
          <Tooltip label="Close" placement="bottom">
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. ACS National Meeting"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as Event["event_type"])}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="conference">Conference</option>
              <option value="deadline">Deadline</option>
              <option value="meeting">Meeting</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Start Time <span className="text-gray-300 font-normal">(optional)</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                End Time <span className="text-gray-300 font-normal">(optional)</span>
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">
            Leave times empty for an all-day event.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. San Francisco, CA"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
            <div className="flex gap-2">
              {DEFAULT_COLORS.map((c) => (
                <Tooltip key={c} label={`Use color ${c}`} placement="bottom">
                  <button
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Use color ${c}`}
                    className={`w-6 h-6 rounded-full transition-transform ${
                      color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                    }`}
                    style={{ backgroundColor: c }}
                  />
                </Tooltip>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPto}
                onChange={(e) => setIsPto(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-400"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium text-gray-700">
                  Mark as PTO day
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  This day will be treated like a weekend for streaks and
                  project schedules.
                </span>
              </span>
            </label>
          </div>
        </div>
        {/* P0-1: footer stays pinned */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            Create Event
          </button>
        </div>
      </div>
    </div>
  );
}

// ── External (read-only) Event Modal ─────────────────────────────────────────

function ExternalEventModal({
  event,
  feed,
  onClose,
}: {
  event: ExternalEvent;
  feed: CalendarFeed | null;
  onClose: () => void;
}) {
  // P1-3: Escape key closes the modal
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: event.color }}
            />
            <h3 className="text-base font-semibold text-gray-900">
              Linked Event
            </h3>
            <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
              Read-only
            </span>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        <div className="p-6 space-y-4">
          <h4 className="text-lg font-semibold text-gray-900">{event.title}</h4>
          <p className="text-sm text-gray-600">
            {event.start_date}
            {event.end_date && event.end_date !== event.start_date && (
              <> → {event.end_date}</>
            )}
            {event.start_time && (
              <>
                {" · "}
                {formatTime(event.start_time)}
                {event.end_time && <> – {formatTime(event.end_time)}</>}
              </>
            )}
          </p>
          {event.location && (
            <p className="text-sm text-gray-600">Location: {event.location}</p>
          )}
          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-blue-600 hover:underline break-all"
            >
              {event.url}
            </a>
          )}
          {event.notes && (
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{event.notes}</p>
          )}
          <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-100">
            {feed
              ? `From "${feed.label}" (linked iCal subscription). Edit this event in its source app — your change will sync back within 15 minutes.`
              : "From a linked iCal subscription. Edit this event in its source app — your change will sync back within 15 minutes."}
          </p>
        </div>

        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
