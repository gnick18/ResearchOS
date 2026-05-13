"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/local-api";
import AppShell from "@/components/AppShell";
import CalendarFeedsButton from "@/components/CalendarFeedsButton";
import { useExternalEvents } from "@/lib/calendar/use-external-events";
import type { Event, ExternalEvent } from "@/lib/types";

type CalendarItem =
  | { kind: "native"; event: Event }
  | { kind: "external"; event: ExternalEvent };

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

const EVENT_TYPE_COLORS: Record<string, string> = {
  conference: "#8b5cf6",
  deadline: "#ef4444",
  meeting: "#3b82f6",
  other: "#6b7280",
};

/** Format an HH:MM string into a compact 12h form, e.g. "9:00" → "9:00a",
 *  "13:30" → "1:30p", "00:00" → "12:00a". Returns "" for null/empty. */
function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hour = parseInt(m[1], 10);
  const minute = m[2];
  const period = hour >= 12 ? "p" : "a";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${hour12}${period}` : `${hour12}:${minute}${period}`;
}

/** Sort comparator that puts all-day events first, then sorts timed events by
 *  start_time ascending. */
function eventTimeOrder(a: { start_time?: string | null }, b: { start_time?: string | null }): number {
  const at = a.start_time ?? "";
  const bt = b.start_time ?? "";
  if (at === bt) return 0;
  if (!at) return -1;
  if (!bt) return 1;
  return at.localeCompare(bt);
}

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [prefilledStartDate, setPrefilledStartDate] = useState<string | null>(null);

  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: eventsApi.list,
  });

  const {
    events: externalEvents,
    errorsByFeedId: externalErrors,
    isFetching: externalIsFetching,
    refetch: refetchExternal,
  } = useExternalEvents();

  const [selectedExternal, setSelectedExternal] = useState<ExternalEvent | null>(null);

  // Get current month/year
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Generate calendar days for the current month
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Add days from previous month
    const prevMonth = new Date(currentYear, currentMonth, 0);
    const prevMonthDays = prevMonth.getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(currentYear, currentMonth - 1, prevMonthDays - i),
        isCurrentMonth: false,
      });
    }

    // Add days of current month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(currentYear, currentMonth, i),
        isCurrentMonth: true,
      });
    }

    // Add days from next month to fill the grid (6 rows)
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(currentYear, currentMonth + 1, i),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [currentYear, currentMonth]);

  // Get events for a specific date (native + external merged)
  const getEventsForDate = useCallback((date: Date): CalendarItem[] => {
    // Use local date components to avoid timezone issues
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const native: CalendarItem[] = events
      .filter((event) => {
        const startDate = event.start_date;
        const endDate = event.end_date || event.start_date;
        return dateStr >= startDate && dateStr <= endDate;
      })
      .map((event) => ({ kind: "native", event }));
    const external: CalendarItem[] = externalEvents
      .filter((event) => {
        const startDate = event.start_date;
        const endDate = event.end_date || event.start_date;
        return dateStr >= startDate && dateStr <= endDate;
      })
      .map((event) => ({ kind: "external", event }));
    return [...native, ...external];
  }, [events, externalEvents]);

  // Navigate months
  const goToPrevMonth = useCallback(() => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  }, [currentYear, currentMonth]);

  const goToNextMonth = useCallback(() => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  }, [currentYear, currentMonth]);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Month names
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Use local date to avoid timezone issues (toISOString returns UTC)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

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

        {/* Calendar */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Month navigation */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <button
              onClick={goToPrevMonth}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              title="Previous month"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {monthNames[currentMonth]} {currentYear}
              </h3>
              <button
                onClick={goToToday}
                className="px-3 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg"
              >
                Today
              </button>
            </div>
            <button
              onClick={goToNextMonth}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              title="Next month"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {dayNames.map((day) => (
              <div
                key={day}
                className="px-2 py-3 text-xs font-semibold text-gray-500 text-center"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {calendarDays.map((day, index) => {
              // Use local date components to avoid timezone issues
              const dateStr = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, "0")}-${String(day.date.getDate()).padStart(2, "0")}`;
              const dayEvents = getEventsForDate(day.date);
              const isToday = dateStr === today;

              return (
                <div
                  key={index}
                  onDoubleClick={() => {
                    setPrefilledStartDate(dateStr);
                    setCreating(true);
                  }}
                  className={`min-h-[100px] border-b border-r border-gray-100 p-1 cursor-pointer ${
                    day.isCurrentMonth ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  <div
                    className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday
                        ? "bg-blue-600 text-white"
                        : day.isCurrentMonth
                        ? "text-gray-700"
                        : "text-gray-400"
                    }`}
                  >
                    {day.date.getDate()}
                  </div>
                  <div className="space-y-1">
                    {[...dayEvents]
                      .sort((a, b) => eventTimeOrder(a.event, b.event))
                      .slice(0, 3)
                      .map((item) =>
                        item.kind === "native" ? (
                          <button
                            key={`n-${item.event.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(item.event);
                            }}
                            className="w-full text-left px-1.5 py-0.5 text-[10px] rounded truncate hover:opacity-80"
                            style={{
                              backgroundColor:
                                item.event.color || EVENT_TYPE_COLORS[item.event.event_type],
                              color: "white",
                            }}
                          >
                            {item.event.start_time && (
                              <span className="font-semibold mr-1">
                                {formatTime(item.event.start_time)}
                              </span>
                            )}
                            {item.event.title}
                          </button>
                        ) : (
                          <button
                            key={`x-${item.event.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedExternal(item.event);
                            }}
                            title="Linked calendar event (read-only)"
                            className="w-full text-left px-1.5 py-0.5 text-[10px] rounded truncate hover:opacity-80 flex items-center gap-1"
                            style={{
                              backgroundColor: "white",
                              color: item.event.color,
                              border: `1px solid ${item.event.color}`,
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="8"
                              height="8"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="flex-shrink-0"
                            >
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            {item.event.start_time && (
                              <span className="font-semibold flex-shrink-0">
                                {formatTime(item.event.start_time)}
                              </span>
                            )}
                            <span className="truncate">{item.event.title}</span>
                          </button>
                        )
                      )}
                    {dayEvents.length > 3 && (
                      <p className="text-[10px] text-gray-400 px-1.5">
                        +{dayEvents.length - 3} more
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Upcoming events list */}
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Upcoming Events</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {([
              ...events.map((e) => ({ kind: "native" as const, event: e })),
              ...externalEvents.map((e) => ({ kind: "external" as const, event: e })),
            ] as CalendarItem[])
              .filter((it) => (it.event.end_date || it.event.start_date) >= today)
              .sort((a, b) => a.event.start_date.localeCompare(b.event.start_date))
              .slice(0, 6)
              .map((item) => {
                const color =
                  item.kind === "native"
                    ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
                    : item.event.color;
                return (
                  <div
                    key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                    onClick={() =>
                      item.kind === "native"
                        ? setSelectedEvent(item.event)
                        : setSelectedExternal(item.event)
                    }
                    className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-1 h-12 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            {item.event.title}
                          </h4>
                          {item.kind === "external" && (
                            <span
                              title="Linked calendar (read-only)"
                              className="inline-flex flex-shrink-0 items-center justify-center"
                              style={{ color }}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                              </svg>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {item.event.start_date}
                          {item.event.end_date &&
                            item.event.end_date !== item.event.start_date && (
                              <> → {item.event.end_date}</>
                            )}
                          {item.event.start_time && (
                            <>
                              {" · "}
                              {formatTime(item.event.start_time)}
                              {item.event.end_time && (
                                <> – {formatTime(item.event.end_time)}</>
                              )}
                            </>
                          )}
                        </p>
                        {item.event.location && (
                          <p className="text-xs text-gray-500 mt-1 truncate">
                            {item.event.location}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
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
          onDelete={async () => {
            if (!selectedEvent) return;
            if (!confirm(`Delete "${selectedEvent.title}"?`)) return;
            try {
              await eventsApi.delete(selectedEvent.id);
              await queryClient.refetchQueries({ queryKey: ["events"] });
              setSelectedEvent(null);
            } catch {
              alert("Failed to delete event");
            }
          }}
          onSave={async (data) => {
            if (!editingEvent) return;
            try {
              await eventsApi.update(editingEvent.id, data);
              await queryClient.refetchQueries({ queryKey: ["events"] });
              setEditingEvent(null);
            } catch {
              alert("Failed to update event");
            }
          }}
        />
      )}

      {/* External (read-only) Event Modal */}
      {selectedExternal && (
        <ExternalEventModal
          event={selectedExternal}
          onClose={() => setSelectedExternal(null)}
        />
      )}

      {/* Create Event Modal */}
      {creating && (
        <CreateEventModal
          defaultStartDate={prefilledStartDate || undefined}
          onClose={() => {
            setCreating(false);
            setPrefilledStartDate(null);
          }}
          onCreate={async (data) => {
            try {
              await eventsApi.create({
                title: data.title!,
                event_type: data.event_type || "other",
                start_date: data.start_date!,
                end_date: data.end_date,
                location: data.location,
                url: data.url,
                notes: data.notes,
                color: data.color,
              });
              await queryClient.refetchQueries({ queryKey: ["events"] });
              setCreating(false);
              setPrefilledStartDate(null);
            } catch {
              alert("Failed to create event");
            }
          }}
        />
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

  const handleSave = () => {
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
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            {isEditing ? "Edit Event" : "Event Details"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" title="Close">
            ✕
          </button>
        </div>
        <div className="p-6">
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
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              {(startTime || endTime) && (
                <button
                  type="button"
                  onClick={() => {
                    setStartTime("");
                    setEndTime("");
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
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      title={`Use color ${c}`}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
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
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          {isEditing ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button onClick={handleSave} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
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
}: {
  onClose: () => void;
  onCreate: (data: Partial<Event>) => void;
  defaultStartDate?: string;
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
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [color, setColor] = useState("");

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
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">New Event</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" title="Close">
            ✕
          </button>
        </div>
        <div className="p-6 space-y-4">
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
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  title={`Use color ${c}`}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
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
        </div>
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
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
  onClose,
}: {
  event: ExternalEvent;
  onClose: () => void;
}) {
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
            <h3 className="text-base font-semibold text-gray-900">Linked Event</h3>
            <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
              Read-only
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
            title="Close"
          >
            ✕
          </button>
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
            From a linked calendar. Edit this event in its source app (Google,
            Outlook, iCloud) — changes will sync back within 15 min.
          </p>
        </div>
        <div className="flex justify-end px-6 py-4 border-t border-gray-100">
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
