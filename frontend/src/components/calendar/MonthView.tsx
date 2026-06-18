"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Event, ExternalEvent } from "@/lib/types";
import { hasEnded } from "@/lib/calendar/event-status";
import { getReadableTextColor } from "@/lib/colors";
import {
  type CalendarItem,
  EVENT_TYPE_COLORS,
  eventCoversDate,
  eventTimeOrder,
  formatTime,
  toLocalDateString,
} from "./utils";

const ENDED_CLASSES = "line-through opacity-60";

interface Props {
  anchor: Date;
  events: Event[];
  externalEvents: ExternalEvent[];
  onDayClick: (dateStr: string) => void;
  onDayDoubleClick: (dateStr: string) => void;
  onEventClick: (event: Event) => void;
  onExternalClick: (event: ExternalEvent) => void;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthView({
  anchor,
  events,
  externalEvents,
  onDayClick,
  onDayDoubleClick,
  onEventClick,
  onExternalClick,
}: Props) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days: { date: Date; isCurrentMonth: boolean }[] = [];
    const prevMonth = new Date(year, month, 0);
    const prevMonthDays = prevMonth.getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthDays - i),
        isCurrentMonth: false,
      });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  }, [year, month]);

  const getEventsForDate = useCallback(
    (date: Date): CalendarItem[] => {
      const dateStr = toLocalDateString(date);
      const native: CalendarItem[] = events
        .filter((event) => eventCoversDate(event, dateStr))
        .map((event) => ({ kind: "native", event }));
      const external: CalendarItem[] = externalEvents
        .filter((event) => eventCoversDate(event, dateStr))
        .map((event) => ({ kind: "external", event }));
      return [...native, ...external];
    },
    [events, externalEvents]
  );

  // 60s tick so ended-event greying transitions live without a page reload.
  // Multi-day-month view doesn't have a "now" line; the tick is purely for
  // the strikethrough state.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = toLocalDateString(now);

  return (
    <div className="bg-surface-raised border border-border rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="px-2 py-3 text-meta font-semibold text-foreground-muted text-center"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, index) => {
          const dateStr = toLocalDateString(day.date);
          const dayEvents = getEventsForDate(day.date);
          const sorted = [...dayEvents].sort((a, b) => eventTimeOrder(a.event, b.event));
          const isToday = dateStr === today;
          return (
            <div
              key={index}
              onClick={() => onDayClick(dateStr)}
              onDoubleClick={() => onDayDoubleClick(dateStr)}
              title="Click to see all events · Double-click to add a new event"
              className={`min-h-[100px] border-b border-r border-border p-1 cursor-pointer ${
                day.isCurrentMonth
                  ? "bg-surface-raised hover:bg-surface-sunken"
                  : "bg-surface-sunken hover:bg-surface-sunken"
              }`}
            >
              <div
                className={`text-meta font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                  isToday
                    ? "bg-amber-400 text-amber-900"
                    : day.isCurrentMonth
                      ? "text-foreground"
                      : "text-foreground-muted"
                }`}
              >
                {day.date.getDate()}
              </div>
              <div className="space-y-1">
                {sorted.slice(0, 3).map((item) => {
                  const ended = hasEnded(item.event, now);
                  const isPto =
                    item.kind === "native" && item.event.is_pto === true;
                  const itemColor =
                    item.kind === "native"
                      ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
                      : item.event.color;
                  const textColor = getReadableTextColor(itemColor);
                  return item.kind === "native" ? (
                    <button
                      key={`n-${item.event.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(item.event);
                      }}
                      title={
                        isPto ? "PTO day, won't break your streak" : undefined
                      }
                      data-pto={isPto ? "true" : undefined}
                      data-beaker-target={`event:${item.event.id}`}
                      className={`w-full text-left px-1.5 py-0.5 text-meta rounded truncate hover:opacity-80 flex items-center gap-1 ${
                        isPto ? "ring-1 ring-sky-300 ring-inset" : ""
                      } ${ended ? ENDED_CLASSES : ""}`}
                      style={{
                        backgroundColor: itemColor,
                        color: textColor,
                      }}
                    >
                      {isPto && (
                        <span className="flex-shrink-0 px-1 py-px text-meta font-bold leading-none rounded bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-200">
                          PTO
                        </span>
                      )}
                      {item.event.start_time && (
                        <span className="font-semibold mr-1">
                          {formatTime(item.event.start_time)}
                        </span>
                      )}
                      <span className="truncate">{item.event.title}</span>
                    </button>
                  ) : (
                    <button
                      key={`x-${item.event.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onExternalClick(item.event);
                      }}
                      title="Linked calendar event (read-only)"
                      data-beaker-target={`external:${item.event.id}`}
                      className={`w-full text-left px-1.5 py-0.5 text-meta rounded truncate hover:opacity-80 flex items-center gap-1 ${ended ? ENDED_CLASSES : ""}`}
                      style={{
                        backgroundColor: itemColor,
                        color: textColor,
                        border: `1px solid ${itemColor}`,
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
                  );
                })}
                {sorted.length > 3 && (
                  <p className="text-meta text-foreground-muted px-1.5">
                    +{sorted.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
