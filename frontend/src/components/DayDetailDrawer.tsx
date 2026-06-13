"use client";

import { useEffect, useMemo, useState } from "react";
import type { Event, ExternalEvent } from "@/lib/types";
import { hasEnded } from "@/lib/calendar/event-status";
import Tooltip from "./Tooltip";

const ENDED_CLASSES = "line-through opacity-60";

const EVENT_TYPE_COLORS: Record<string, string> = {
  conference: "#8b5cf6",
  deadline: "#ef4444",
  meeting: "#3b82f6",
  other: "#6b7280",
};

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

function timeOrder(a: { start_time: string | null }, b: { start_time: string | null }): number {
  const at = a.start_time ?? "";
  const bt = b.start_time ?? "";
  if (at === bt) return 0;
  if (!at) return -1;
  if (!bt) return 1;
  return at.localeCompare(bt);
}

interface Props {
  dateStr: string; // YYYY-MM-DD
  events: Event[];
  externalEvents: ExternalEvent[];
  onClose: () => void;
  onSelectNative: (event: Event) => void;
  onSelectExternal: (event: ExternalEvent) => void;
  onCreate: (dateStr: string) => void;
}

export default function DayDetailDrawer({
  dateStr,
  events,
  externalEvents,
  onClose,
  onSelectNative,
  onSelectExternal,
  onCreate,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 60s tick so the drawer's strikethrough state updates live while open.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { allDay, timed } = useMemo(() => {
    const allDay: Array<{ kind: "native"; event: Event } | { kind: "external"; event: ExternalEvent }> = [];
    const timed: Array<{ kind: "native"; event: Event } | { kind: "external"; event: ExternalEvent }> = [];
    for (const e of events) {
      const item = { kind: "native" as const, event: e };
      if (e.start_time) timed.push(item);
      else allDay.push(item);
    }
    for (const e of externalEvents) {
      const item = { kind: "external" as const, event: e };
      if (e.start_time) timed.push(item);
      else allDay.push(item);
    }
    timed.sort((a, b) => timeOrder(a.event, b.event));
    return { allDay, timed };
  }, [events, externalEvents]);

  // Parse YYYY-MM-DD as local-time date for display
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const heading = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const totalCount = allDay.length + timed.length;

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px] flex justify-end"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this drawer
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="day-detail-drawer"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised w-full max-w-md h-full shadow-2xl flex flex-col animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border bg-surface-sunken flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-foreground">{heading}</h3>
            <p className="text-meta text-foreground-muted mt-0.5">
              {totalCount === 0
                ? "No events"
                : `${totalCount} event${totalCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <Tooltip label="Close (Esc)" placement="bottom">
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground-muted text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {totalCount === 0 && (
            <div className="text-center py-8">
              <p className="text-body text-foreground-muted">Nothing scheduled.</p>
            </div>
          )}

          {allDay.length > 0 && (
            <section>
              <h4 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-2">
                All-day
              </h4>
              <ul className="space-y-1.5">
                {allDay.map((item) => (
                  <DayDetailRow
                    key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                    item={item}
                    onSelectNative={onSelectNative}
                    onSelectExternal={onSelectExternal}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          )}

          {timed.length > 0 && (
            <section>
              <h4 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-2">
                Scheduled
              </h4>
              <ul className="space-y-1.5">
                {timed.map((item) => (
                  <DayDetailRow
                    key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                    item={item}
                    onSelectNative={onSelectNative}
                    onSelectExternal={onSelectExternal}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-surface-sunken flex justify-end">
          <button
            onClick={() => onCreate(dateStr)}
            className="px-3 py-1.5 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
          >
            + New event on this day
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.18s ease-out;
        }
      `}</style>
    </div>
  );
}

function DayDetailRow({
  item,
  onSelectNative,
  onSelectExternal,
  now,
}: {
  item:
    | { kind: "native"; event: Event }
    | { kind: "external"; event: ExternalEvent };
  onSelectNative: (event: Event) => void;
  onSelectExternal: (event: ExternalEvent) => void;
  now: Date;
}) {
  const color =
    item.kind === "native"
      ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
      : item.event.color;
  const onClick =
    item.kind === "native"
      ? () => onSelectNative(item.event)
      : () => onSelectExternal(item.event);
  const timeLabel =
    item.event.start_time
      ? `${formatTime(item.event.start_time)}${
          item.event.end_time ? ` – ${formatTime(item.event.end_time)}` : ""
        }`
      : "All-day";
  const ended = hasEnded(item.event, now);

  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left flex items-start gap-3 px-3 py-2 rounded-lg border border-border hover:border-border hover:bg-surface-sunken transition-colors ${ended ? ENDED_CLASSES : ""}`}
      >
        <span
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-body font-medium text-foreground truncate">
              {item.event.title}
            </p>
            {item.kind === "external" && (
              <span title="Linked calendar (read-only)" style={{ color }}>
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
                  className="flex-shrink-0"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </span>
            )}
          </div>
          <p className="text-meta text-foreground-muted mt-0.5">{timeLabel}</p>
          {item.event.location && (
            <p className="text-meta text-foreground-muted mt-0.5 truncate">
              {item.event.location}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}
