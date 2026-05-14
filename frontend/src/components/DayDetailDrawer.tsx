"use client";

import { useEffect, useMemo } from "react";
import type { Event, ExternalEvent } from "@/lib/types";
import Tooltip from "./Tooltip";

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
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{heading}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {totalCount === 0
                ? "No events"
                : `${totalCount} event${totalCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <Tooltip label="Close (Esc)" placement="bottom">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {totalCount === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400">Nothing scheduled.</p>
            </div>
          )}

          {allDay.length > 0 && (
            <section>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                All-day
              </h4>
              <ul className="space-y-1.5">
                {allDay.map((item) => (
                  <DayDetailRow
                    key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                    item={item}
                    onSelectNative={onSelectNative}
                    onSelectExternal={onSelectExternal}
                  />
                ))}
              </ul>
            </section>
          )}

          {timed.length > 0 && (
            <section>
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Scheduled
              </h4>
              <ul className="space-y-1.5">
                {timed.map((item) => (
                  <DayDetailRow
                    key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
                    item={item}
                    onSelectNative={onSelectNative}
                    onSelectExternal={onSelectExternal}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button
            onClick={() => onCreate(dateStr)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
}: {
  item:
    | { kind: "native"; event: Event }
    | { kind: "external"; event: ExternalEvent };
  onSelectNative: (event: Event) => void;
  onSelectExternal: (event: ExternalEvent) => void;
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

  return (
    <li>
      <button
        onClick={onClick}
        className="w-full text-left flex items-start gap-3 px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
      >
        <span
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-gray-900 truncate">
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
          <p className="text-xs text-gray-500 mt-0.5">{timeLabel}</p>
          {item.event.location && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              {item.event.location}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}
