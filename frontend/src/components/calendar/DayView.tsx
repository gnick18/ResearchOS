"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Event, ExternalEvent } from "@/lib/types";
import { hasEnded } from "@/lib/calendar/event-status";
import { getReadableTextColor } from "@/lib/colors";
import {
  assignLanes,
  type CalendarItem,
  EVENT_TYPE_COLORS,
  eventCoversDate,
  eventTimeOrder,
  formatTime,
  minutesToTime,
  splitDayItems,
  timeToMinutes,
  toLocalDateString,
} from "./utils";

// Tailwind classes layered on top of any color styles when an event has
// passed. Keeps the original color accent visible (via the chip background
// / border) but de-emphasizes the row.
const ENDED_CLASSES = "line-through opacity-60";

interface Props {
  anchor: Date;
  events: Event[];
  externalEvents: ExternalEvent[];
  onEventClick: (event: Event) => void;
  onExternalClick: (event: ExternalEvent) => void;
  onCreateAt: (dateStr: string, startTime: string | null) => void;
}

const HOUR_HEIGHT = 60;
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;

export default function DayView({
  anchor,
  events,
  externalEvents,
  onEventClick,
  onExternalClick,
  onCreateAt,
}: Props) {
  const dateStr = toLocalDateString(anchor);
  const todayStr = toLocalDateString(new Date());
  const isToday = dateStr === todayStr;

  const items = useMemo(() => {
    const out: CalendarItem[] = [];
    for (const e of events) {
      if (eventCoversDate(e, dateStr)) {
        out.push({ kind: "native", event: e });
      }
    }
    for (const e of externalEvents) {
      if (eventCoversDate(e, dateStr)) {
        out.push({ kind: "external", event: e });
      }
    }
    return out;
  }, [dateStr, events, externalEvents]);

  const { allDay, timed } = useMemo(() => splitDayItems(items, dateStr), [items, dateStr]);
  const sortedAllDay = useMemo(
    () => [...allDay].sort((a, b) => eventTimeOrder(a.event, b.event)),
    [allDay]
  );
  const laneAssignments = useMemo(() => assignLanes(timed), [timed]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    const targetMinutes = isToday ? now.getHours() * 60 + now.getMinutes() - 60 : 7 * 60;
    scrollRef.current.scrollTop = Math.max(0, (targetMinutes / 60) * HOUR_HEIGHT);
  }, [isToday]);

  // 60s tick drives both the red "now" line and the ended-event greying.
  // We keep a Date so the `hasEnded` helper has its full input shape (the
  // sidebar shares the same helper — single source of truth for cutoff).
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const heading = anchor.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="bg-surface-raised border border-border rounded-xl overflow-hidden flex flex-col">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-body font-semibold text-foreground">{heading}</h3>
        {isToday && (
          <span className="text-meta uppercase tracking-wide text-blue-600 dark:text-blue-300 font-semibold">
            Today
          </span>
        )}
      </div>

      {/* All-day strip */}
      {sortedAllDay.length > 0 && (
        <div className="border-b border-border bg-surface-sunken/40 px-5 py-2 space-y-1">
          <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold">
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
              return item.kind === "native" ? (
                <button
                  key={`n-${item.event.id}`}
                  onClick={() => onEventClick(item.event)}
                  data-beaker-target={`event:${item.event.id}`}
                  className={`w-full text-left px-2 py-1 text-meta rounded hover:opacity-90 ${ended ? ENDED_CLASSES : ""}`}
                  style={{
                    backgroundColor: itemColor,
                    color: textColor,
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
                  onClick={() => onExternalClick(item.event)}
                  title="Linked calendar event (read-only)"
                  data-beaker-target={`external:${item.event.id}`}
                  className={`w-full text-left px-2 py-1 text-meta rounded hover:opacity-90 flex items-center gap-1 ${ended ? ENDED_CLASSES : ""}`}
                  style={{
                    backgroundColor: itemColor,
                    color: textColor,
                    border: `1px solid ${itemColor}`,
                  }}
                >
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
          </div>
        </div>
      )}

      {/* Time grid */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 320px)" }}
      >
        <div
          className="grid grid-cols-[70px_1fr] relative"
          style={{ height: TOTAL_HEIGHT }}
        >
          {/* Hour labels */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="border-t border-border text-meta text-foreground-muted text-right pr-3 pt-0.5"
                style={{ height: HOUR_HEIGHT }}
              >
                {h === 0 ? "" : h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`}
              </div>
            ))}
          </div>

          {/* Day column */}
          <div
            className="relative border-l border-border"
            onClick={(e) => {
              if (e.target !== e.currentTarget) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const offsetY = e.clientY - rect.top;
              const minutes = Math.round((offsetY / HOUR_HEIGHT) * 60 / 15) * 15;
              onCreateAt(dateStr, minutesToTime(minutes));
            }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="border-t border-border pointer-events-none"
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
              const height = Math.max(((Math.max(end, start + 15) - start) / 60) * HOUR_HEIGHT, 24);
              const widthPct = 100 / laneCount;
              const leftPct = lane * widthPct;
              const color =
                item.kind === "native"
                  ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
                  : item.event.color;
              const handleClick =
                item.kind === "native"
                  ? () => onEventClick(item.event)
                  : () => onExternalClick(item.event);
              const ended = hasEnded(item.event, now);

              const textColor = getReadableTextColor(color);
              return (
                <button
                  key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClick();
                  }}
                  data-beaker-target={
                    item.kind === "native"
                      ? `event:${item.event.id}`
                      : `external:${item.event.id}`
                  }
                  className={`absolute rounded-md px-2 py-1 text-left overflow-hidden hover:opacity-90 z-10 ${ended ? ENDED_CLASSES : ""}`}
                  style={{
                    top,
                    height: height - 1,
                    left: `calc(${leftPct}% + 4px)`,
                    width: `calc(${widthPct}% - 8px)`,
                    backgroundColor: color,
                    color: textColor,
                    border: item.kind === "external" ? `1px solid ${color}` : "none",
                  }}
                >
                  <p className="text-meta font-medium truncate flex items-center gap-1">
                    {item.kind === "external" && (
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
                        className="flex-shrink-0"
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    )}
                    <span className="truncate">{item.event.title}</span>
                  </p>
                  <p className="text-meta opacity-80 truncate">
                    {formatTime(item.event.start_time)}
                    {item.event.end_time && ` – ${formatTime(item.event.end_time)}`}
                  </p>
                  {item.event.location && height > 50 && (
                    <p className="text-meta opacity-70 truncate">
                      {item.event.location}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
