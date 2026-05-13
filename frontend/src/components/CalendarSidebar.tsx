"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { eventsApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useCalendarFeeds,
  useExternalEvents,
} from "@/lib/calendar/use-external-events";
import { updateFeed } from "@/lib/calendar/external-feeds-store";
import { useCalendarNavStore } from "@/lib/calendar/calendar-nav-store";
import {
  EVENT_TYPE_COLORS,
  formatTime,
  toLocalDateString,
} from "@/components/calendar/utils";
import CalendarFeedsModal from "./CalendarFeedsModal";
import CalendarRemindersModal from "./CalendarRemindersModal";
import type { CalendarFeed, Event, ExternalEvent } from "@/lib/types";

type UpcomingItem =
  | { kind: "native"; event: Event; sortKey: string }
  | { kind: "external"; event: ExternalEvent; sortKey: string };

const UPCOMING_DAYS = 30;
const MAX_ITEMS = 40;

export default function CalendarSidebar() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const [feedsModalOpen, setFeedsModalOpen] = useState(false);
  const [remindersModalOpen, setRemindersModalOpen] = useState(false);
  const jumpTo = useCalendarNavStore((s) => s.jumpTo);

  const { data: feeds = [] } = useCalendarFeeds();
  const { events: externalEvents } = useExternalEvents();
  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: eventsApi.list,
  });

  const todayStr = toLocalDateString(new Date());
  const horizonStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + UPCOMING_DAYS);
    return toLocalDateString(d);
  }, []);

  const grouped = useMemo(() => {
    const items: UpcomingItem[] = [];
    for (const e of events) {
      const end = e.end_date || e.start_date;
      if (end < todayStr) continue;
      if (e.start_date > horizonStr) continue;
      // For multi-day events, anchor in the list at today if it's currently
      // ongoing, otherwise at its start_date.
      const anchor = e.start_date < todayStr ? todayStr : e.start_date;
      items.push({
        kind: "native",
        event: e,
        sortKey: `${anchor}T${e.start_time ?? "00:00"}`,
      });
    }
    for (const e of externalEvents) {
      const end = e.end_date || e.start_date;
      if (end < todayStr) continue;
      if (e.start_date > horizonStr) continue;
      const anchor = e.start_date < todayStr ? todayStr : e.start_date;
      items.push({
        kind: "external",
        event: e,
        sortKey: `${anchor}T${e.start_time ?? "00:00"}`,
      });
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    // Group by display date (start_date if in the future; else today)
    const byDate = new Map<string, UpcomingItem[]>();
    for (const it of items.slice(0, MAX_ITEMS)) {
      const date = it.sortKey.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(it);
    }
    return byDate;
  }, [events, externalEvents, todayStr, horizonStr]);

  const handleToggleFeed = async (feed: CalendarFeed) => {
    if (!currentUser) return;
    await updateFeed(currentUser, feed.id, { enabled: !feed.enabled });
    queryClient.invalidateQueries({ queryKey: ["calendar-feeds", currentUser] });
    queryClient.invalidateQueries({ queryKey: ["calendar-feed-events"] });
  };

  const handleEventClick = (dateStr: string) => {
    jumpTo("day", dateStr);
    // Make sure we're on the calendar route (no-op if already)
    router.push("/calendar");
  };

  const totalEnabled = feeds.filter((f) => f.enabled).length;

  return (
    <>
      <aside className="w-64 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0">
        {/* Linked Calendars */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Calendars
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRemindersModalOpen(true)}
              title="Configure event reminders"
              className="text-[11px] text-blue-600 hover:underline"
            >
              Reminders
            </button>
            <span className="text-[10px] text-gray-300">·</span>
            <button
              onClick={() => setFeedsModalOpen(true)}
              title="Manage linked calendars"
              className="text-[11px] text-blue-600 hover:underline"
            >
              Manage
            </button>
          </div>
        </div>
        <div className="px-3 py-2 space-y-1">
          <FeedRow
            label="ResearchOS events"
            color="#3b82f6"
            enabled={true}
            disabled
            description="Native"
          />
          {feeds.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic px-1 pt-2">
              No linked calendars.
              <button
                onClick={() => setFeedsModalOpen(true)}
                className="ml-1 text-blue-600 hover:underline"
              >
                Link one
              </button>
            </p>
          ) : (
            feeds.map((feed) => (
              <FeedRow
                key={feed.id}
                label={feed.label}
                color={feed.color}
                enabled={feed.enabled}
                description={providerLabel(feed.provider)}
                onToggle={() => handleToggleFeed(feed)}
              />
            ))
          )}
        </div>

        {/* Upcoming */}
        <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Upcoming
          </h2>
          {totalEnabled > 0 && (
            <span className="text-[10px] text-gray-300">
              {totalEnabled} feed{totalEnabled === 1 ? "" : "s"} on
            </span>
          )}
        </div>
        <div className="p-3 space-y-3">
          {grouped.size === 0 ? (
            <p className="text-[11px] text-gray-300 italic px-1">
              Nothing in the next {UPCOMING_DAYS} days.
            </p>
          ) : (
            Array.from(grouped.entries()).map(([dateStr, items]) => (
              <DayGroup
                key={dateStr}
                dateStr={dateStr}
                items={items}
                onEventClick={handleEventClick}
              />
            ))
          )}
        </div>
      </aside>
      {feedsModalOpen && (
        <CalendarFeedsModal onClose={() => setFeedsModalOpen(false)} />
      )}
      {remindersModalOpen && (
        <CalendarRemindersModal onClose={() => setRemindersModalOpen(false)} />
      )}
    </>
  );
}

function providerLabel(provider: CalendarFeed["provider"]): string {
  switch (provider) {
    case "google":
      return "Google";
    case "outlook":
      return "Outlook";
    case "icloud":
      return "iCloud";
    case "other":
      return "iCal";
  }
}

function FeedRow({
  label,
  color,
  enabled,
  description,
  disabled,
  onToggle,
}: {
  label: string;
  color: string;
  enabled: boolean;
  description: string;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={
        disabled
          ? "Always shown"
          : enabled
            ? "Click to hide"
            : "Click to show"
      }
      className={`w-full text-left px-2 py-1 rounded-md flex items-center gap-2 ${
        disabled
          ? "cursor-default"
          : "hover:bg-gray-50 cursor-pointer"
      }`}
    >
      <span
        className={`inline-block w-2.5 h-2.5 rounded-sm transition-opacity ${
          enabled ? "opacity-100" : "opacity-25"
        }`}
        style={{ backgroundColor: color }}
      />
      <div className="flex-1 min-w-0">
        <p
          className={`text-xs font-medium truncate ${
            enabled ? "text-gray-700" : "text-gray-400"
          }`}
        >
          {label}
        </p>
        <p className="text-[10px] uppercase tracking-wide text-gray-300">
          {description}
        </p>
      </div>
      {!disabled && (
        <span
          className={`text-[10px] ${
            enabled ? "text-gray-400" : "text-gray-300"
          }`}
        >
          {enabled ? "✓" : ""}
        </span>
      )}
    </button>
  );
}

function DayGroup({
  dateStr,
  items,
  onEventClick,
}: {
  dateStr: string;
  items: UpcomingItem[];
  onEventClick: (dateStr: string) => void;
}) {
  const today = toLocalDateString(new Date());
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toLocalDateString(d);
  })();
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  let header: string;
  if (dateStr === today) header = "Today";
  else if (dateStr === tomorrow) header = "Tomorrow";
  else {
    header = date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div>
      <p
        className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 px-1 ${
          dateStr === today ? "text-blue-600" : "text-gray-400"
        }`}
      >
        {header}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <UpcomingRow
            key={item.kind === "native" ? `n-${item.event.id}` : `x-${item.event.id}`}
            item={item}
            onClick={() => onEventClick(dateStr)}
          />
        ))}
      </ul>
    </div>
  );
}

function UpcomingRow({
  item,
  onClick,
}: {
  item: UpcomingItem;
  onClick: () => void;
}) {
  const color =
    item.kind === "native"
      ? item.event.color || EVENT_TYPE_COLORS[item.event.event_type]
      : item.event.color;
  const timeLabel = item.event.start_time ? formatTime(item.event.start_time) : null;

  return (
    <li>
      <button
        onClick={onClick}
        title="Jump to this day"
        className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded hover:bg-gray-50 group"
      >
        <span
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-800 truncate flex items-center gap-1">
            {item.kind === "external" && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color }}
                className="flex-shrink-0"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
            <span className="truncate">{item.event.title}</span>
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {timeLabel ?? "All-day"}
            {item.event.location && (
              <span className="ml-1 truncate">· {item.event.location}</span>
            )}
          </p>
        </div>
      </button>
    </li>
  );
}
