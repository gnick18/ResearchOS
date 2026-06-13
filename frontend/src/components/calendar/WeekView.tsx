"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Event, ExternalEvent } from "@/lib/types";
import { hasEnded } from "@/lib/calendar/event-status";
import { getReadableTextColor } from "@/lib/colors";
import {
  assignLanes,
  type CalendarItem,
  EVENT_TYPE_COLORS,
  eventTimeOrder,
  formatTime,
  getWeekDays,
  minutesToTime,
  splitDayItems,
  timeToMinutes,
  toLocalDateString,
} from "./utils";

const ENDED_CLASSES = "line-through opacity-60";

interface Props {
  anchor: Date;
  events: Event[];
  externalEvents: ExternalEvent[];
  onDayHeaderClick: (dateStr: string) => void;
  onEventClick: (event: Event) => void;
  onExternalClick: (event: ExternalEvent) => void;
  onCreateAt: (dateStr: string, startTime: string | null) => void;
}

const HOUR_HEIGHT = 48;
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;

export default function WeekView({
  anchor,
  events,
  externalEvents,
  onDayHeaderClick,
  onEventClick,
  onExternalClick,
  onCreateAt,
}: Props) {
  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const todayStr = toLocalDateString(new Date());

  // Build items per day
  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const d of weekDays) {
      const dateStr = toLocalDateString(d);
      const items: CalendarItem[] = [];
      for (const e of events) {
        if (dateStr >= e.start_date && dateStr <= (e.end_date || e.start_date)) {
          items.push({ kind: "native", event: e });
        }
      }
      for (const e of externalEvents) {
        if (dateStr >= e.start_date && dateStr <= (e.end_date || e.start_date)) {
          items.push({ kind: "external", event: e });
        }
      }
      map.set(dateStr, items);
    }
    return map;
  }, [weekDays, events, externalEvents]);

  // Auto-scroll to ~7am (or current time on today) on mount.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    const targetMinutes = weekDays.some((d) => toLocalDateString(d) === todayStr)
      ? now.getHours() * 60 + now.getMinutes() - 60 // 1 hour before now
      : 7 * 60;
    scrollRef.current.scrollTop = Math.max(0, (targetMinutes / 60) * HOUR_HEIGHT);
  }, [weekDays, todayStr]);

  // 60s tick drives both the red "now" line and the ended-event greying.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="bg-surface-raised border border-border rounded-xl overflow-hidden flex flex-col">
      {/* Day-of-week header strip */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border sticky top-0 bg-surface-raised z-10">
        <div className="px-2 py-2" />
        {weekDays.map((d) => {
          const dateStr = toLocalDateString(d);
          const isToday = dateStr === todayStr;
          return (
            <button
              key={dateStr}
              onClick={() => onDayHeaderClick(dateStr)}
              className="px-2 py-2 text-center hover:bg-surface-sunken border-l border-border"
              title="Click to view all events on this day"
            >
              <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </p>
              <p
                className={`mt-1 inline-flex items-center justify-center w-7 h-7 rounded-full text-body font-medium ${
                  isToday ? "bg-amber-400 text-amber-900" : "text-foreground"
                }`}
              >
                {d.getDate()}
              </p>
            </button>
          );
        })}
      </div>

      {/* All-day strip */}
      <AllDayStrip
        weekDays={weekDays}
        itemsByDate={itemsByDate}
        onEventClick={onEventClick}
        onExternalClick={onExternalClick}
        now={now}
      />

      {/* Hourly time grid (scrollable) */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 320px)" }}
      >
        <div
          className="grid grid-cols-[60px_repeat(7,1fr)] relative"
          style={{ height: TOTAL_HEIGHT }}
        >
          {/* Hour labels column */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="border-t border-border text-meta text-foreground-muted text-right pr-2 pt-0.5"
                style={{ height: HOUR_HEIGHT }}
              >
                {h === 0 ? "" : h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}
              </div>
            ))}
          </div>

          {/* Per-day columns */}
          {weekDays.map((d) => {
            const dateStr = toLocalDateString(d);
            const dayItems = itemsByDate.get(dateStr) ?? [];
            const { timed } = splitDayItems(dayItems, dateStr);
            const laneAssignments = assignLanes(timed);
            const isToday = dateStr === todayStr;
            return (
              <div
                key={dateStr}
                className="relative border-l border-border"
                onClick={(e) => {
                  // Only fire on background clicks, not on events
                  if (e.target !== e.currentTarget) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const offsetY = e.clientY - rect.top;
                  const minutes = Math.round((offsetY / HOUR_HEIGHT) * 60 / 15) * 15;
                  onCreateAt(dateStr, minutesToTime(minutes));
                }}
              >
                {/* Hour grid lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="border-t border-border pointer-events-none"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}

                {/* "Now" line on today */}
                {isToday && (
                  <div
                    className="absolute left-0 right-0 pointer-events-none z-10"
                    style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                  >
                    <div className="h-[2px] bg-red-500" />
                    <div
                      className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500"
                    />
                  </div>
                )}

                {/* Timed events */}
                {laneAssignments.map(({ item, lane, laneCount }) => (
                  <TimedEventBlock
                    key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                    item={item}
                    lane={lane}
                    laneCount={laneCount}
                    onEventClick={onEventClick}
                    onExternalClick={onExternalClick}
                    now={now}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── All-day strip (top row) ──────────────────────────────────────────────────

function AllDayStrip({
  weekDays,
  itemsByDate,
  onEventClick,
  onExternalClick,
  now,
}: {
  weekDays: Date[];
  itemsByDate: Map<string, CalendarItem[]>;
  onEventClick: (event: Event) => void;
  onExternalClick: (event: ExternalEvent) => void;
  now: Date;
}) {
  // For each day, all-day items (single-day all-day or multi-day events).
  const allDayByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const d of weekDays) {
      const dateStr = toLocalDateString(d);
      const items = itemsByDate.get(dateStr) ?? [];
      const { allDay } = splitDayItems(items, dateStr);
      map.set(
        dateStr,
        [...allDay].sort((a, b) => eventTimeOrder(a.event, b.event))
      );
    }
    return map;
  }, [weekDays, itemsByDate]);

  const maxRows = Math.max(2, ...Array.from(allDayByDate.values(), (v) => v.length));
  const stripHeight = Math.min(maxRows, 4) * 22 + 8;
  const overflow = maxRows > 4;

  return (
    <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-surface-sunken/40">
      <div className="px-2 py-1 text-meta uppercase tracking-wide text-foreground-muted font-semibold flex items-start pt-1">
        All-day
      </div>
      {weekDays.map((d) => {
        const dateStr = toLocalDateString(d);
        const items = allDayByDate.get(dateStr) ?? [];
        const visible = overflow ? items.slice(0, 4) : items;
        const extra = items.length - visible.length;
        return (
          <div
            key={dateStr}
            className="border-l border-border px-1 py-1 space-y-0.5 overflow-hidden"
            style={{ minHeight: stripHeight }}
          >
            {visible.map((item) => {
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
                  className={`w-full text-left px-1.5 py-0.5 text-meta rounded truncate hover:opacity-80 ${ended ? ENDED_CLASSES : ""}`}
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
                  className={`w-full text-left px-1.5 py-0.5 text-meta rounded truncate hover:opacity-80 flex items-center gap-1 ${ended ? ENDED_CLASSES : ""}`}
                  style={{
                    backgroundColor: itemColor,
                    color: textColor,
                    border: `1px solid ${itemColor}`,
                  }}
                >
                  {item.event.start_time && (
                    <span className="font-semibold flex-shrink-0">
                      {formatTime(item.event.start_time)}
                    </span>
                  )}
                  <span className="truncate">{item.event.title}</span>
                </button>
              );
            })}
            {extra > 0 && (
              <p className="text-meta text-foreground-muted px-1.5">+{extra} more</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Timed event block (positioned in time grid) ──────────────────────────────

function TimedEventBlock({
  item,
  lane,
  laneCount,
  onEventClick,
  onExternalClick,
  now,
}: {
  item: CalendarItem;
  lane: number;
  laneCount: number;
  onEventClick: (event: Event) => void;
  onExternalClick: (event: ExternalEvent) => void;
  now: Date;
}) {
  const start = timeToMinutes(item.event.start_time) ?? 0;
  const end = timeToMinutes(item.event.end_time) ?? start + 30;
  const top = (start / 60) * HOUR_HEIGHT;
  const height = Math.max(((Math.max(end, start + 15) - start) / 60) * HOUR_HEIGHT, 20);
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

  const isShort = height < 32;
  const ended = hasEnded(item.event, now);
  const textColor = getReadableTextColor(color);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleClick();
      }}
      data-beaker-target={
        item.kind === "native"
          ? `event:${item.event.id}`
          : `external:${item.event.id}`
      }
      className={`absolute rounded-md px-1.5 py-0.5 text-left overflow-hidden hover:opacity-90 transition-opacity z-10 ${ended ? ENDED_CLASSES : ""}`}
      style={{
        top,
        height: height - 1,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: color,
        color: textColor,
        border: item.kind === "external" ? `1px solid ${color}` : "none",
      }}
      title={`${item.event.title}${item.event.start_time ? ` · ${formatTime(item.event.start_time)}${item.event.end_time ? ` – ${formatTime(item.event.end_time)}` : ""}` : ""}`}
    >
      {isShort ? (
        <p className="text-meta font-medium truncate">
          {formatTime(item.event.start_time)} {item.event.title}
        </p>
      ) : (
        <>
          <p className="text-meta font-medium truncate flex items-center gap-1">
            {item.kind === "external" && (
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
            )}
            <span className="truncate">{item.event.title}</span>
          </p>
          <p className="text-meta opacity-80 truncate">
            {formatTime(item.event.start_time)}
            {item.event.end_time && ` – ${formatTime(item.event.end_time)}`}
          </p>
        </>
      )}
    </button>
  );
}
