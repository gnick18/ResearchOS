"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  effectiveEndDate,
  formatTime,
  toLocalDateString,
} from "@/components/calendar/utils";
import { DEFAULT_CALENDAR_COLORS } from "@/lib/calendar/calendar-colors";
import {
  getNativeCalendarColor,
  setNativeCalendarColor,
} from "@/lib/file-system/user-metadata";
import CalendarFeedsModal from "./CalendarFeedsModal";
import CalendarRemindersModal from "./CalendarRemindersModal";
import Tooltip from "./Tooltip";
import type { CalendarFeed, Event, ExternalEvent } from "@/lib/types";

type UpcomingItem =
  | { kind: "native"; event: Event; sortKey: string }
  | { kind: "external"; event: ExternalEvent; sortKey: string };

const UPCOMING_DAYS = 30;
const MAX_ITEMS = 40;
const NATIVE_COLOR_QUERY_KEY = ["calendar-native-color"];

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

  // Native "ResearchOS events" row color. Pulled from user metadata so the
  // user's per-account override (Piece 3) is honored. Falls back to the
  // shared default (#3b82f6) when no override is set, which matches the
  // previously hardcoded value.
  const { data: nativeColor = "#3b82f6" } = useQuery({
    queryKey: [...NATIVE_COLOR_QUERY_KEY, currentUser],
    queryFn: async () =>
      currentUser ? getNativeCalendarColor(currentUser) : "#3b82f6",
    enabled: !!currentUser,
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
      const end = effectiveEndDate(e);
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
      const end = effectiveEndDate(e);
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

  const handleRecolorFeed = useCallback(
    async (feed: CalendarFeed, color: string) => {
      if (!currentUser) return;
      await updateFeed(currentUser, feed.id, { color });
      queryClient.invalidateQueries({
        queryKey: ["calendar-feeds", currentUser],
      });
      queryClient.invalidateQueries({ queryKey: ["calendar-feed-events"] });
    },
    [currentUser, queryClient],
  );

  const handleRecolorNative = useCallback(
    async (color: string) => {
      if (!currentUser) return;
      await setNativeCalendarColor(currentUser, color);
      queryClient.invalidateQueries({
        queryKey: [...NATIVE_COLOR_QUERY_KEY, currentUser],
      });
    },
    [currentUser, queryClient],
  );

  const handleEventClick = (dateStr: string) => {
    jumpTo("day", dateStr);
    // Make sure we're on the calendar route (no-op if already)
    router.push("/calendar");
  };

  const totalEnabled = feeds.filter((f) => f.enabled).length;

  return (
    <>
      <aside className="w-64 border-r border-border bg-surface-raised overflow-y-auto flex-shrink-0">
        {/* Linked Calendars */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-meta font-bold text-foreground-muted uppercase tracking-widest">
            Calendars
          </h2>
          <div className="flex items-center gap-2">
            <Tooltip label="Configure event reminders" placement="bottom">
              <button
                onClick={() => setRemindersModalOpen(true)}
                className="text-meta text-blue-600 dark:text-blue-300 hover:underline"
              >
                Reminders
              </button>
            </Tooltip>
            <span className="text-meta text-foreground-muted">·</span>
            <Tooltip label="Manage linked calendars" placement="bottom">
              <button
                onClick={() => setFeedsModalOpen(true)}
                className="text-meta text-blue-600 dark:text-blue-300 hover:underline"
              >
                Manage
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="px-3 py-2 space-y-1">
          <FeedRow
            label="ResearchOS events"
            color={nativeColor}
            enabled={true}
            description="Native"
            onRecolor={handleRecolorNative}
          />
          {feeds.length === 0 ? (
            <p className="text-meta text-foreground-muted italic px-1 pt-2">
              No linked calendars.
              <button
                onClick={() => setFeedsModalOpen(true)}
                className="ml-1 text-blue-600 dark:text-blue-300 hover:underline"
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
                onRecolor={(c) => handleRecolorFeed(feed, c)}
              />
            ))
          )}
        </div>

        {/* Upcoming */}
        <div className="px-4 py-2 border-t border-border flex items-center justify-between">
          <h2 className="text-meta font-bold text-foreground-muted uppercase tracking-widest">
            Upcoming
          </h2>
          {totalEnabled > 0 && (
            <span className="text-meta text-foreground-muted">
              {totalEnabled} feed{totalEnabled === 1 ? "" : "s"} on
            </span>
          )}
        </div>
        <div className="p-3 space-y-3">
          {grouped.size === 0 ? (
            <p className="text-meta text-foreground-muted italic px-1">
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
      <CalendarFeedsModal
        open={feedsModalOpen}
        onClose={() => setFeedsModalOpen(false)}
      />
      <CalendarRemindersModal
        open={remindersModalOpen}
        onClose={() => setRemindersModalOpen(false)}
      />
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
  onToggle,
  onRecolor,
}: {
  label: string;
  color: string;
  enabled: boolean;
  description: string;
  /** Omitted on the native row, which is always shown and never toggles. */
  onToggle?: () => void;
  /** Opens the color popover on swatch click. Required — every row in the
   *  sidebar is recolor-eligible now (native row included). */
  onRecolor: (color: string) => void | Promise<void>;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const isNative = !onToggle;
  const interactive = !!onToggle;

  // Close the popover on outside click and Escape. Anchored off the row
  // so re-renders (e.g. after a recolor invalidate) don't break the
  // outside-click reference.
  useEffect(() => {
    if (!popoverOpen) return;
    const onDocPointerDown = (e: MouseEvent) => {
      if (!rowRef.current) return;
      if (rowRef.current.contains(e.target as Node)) return;
      setPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const handleSwatchClick = (e: ReactMouseEvent) => {
    // Stop the outer row's toggle from firing when the swatch is clicked.
    e.stopPropagation();
    e.preventDefault();
    setPopoverOpen((v) => !v);
  };

  const handlePick = async (c: string) => {
    setPopoverOpen(false);
    await onRecolor(c);
  };

  return (
    <div
      ref={rowRef}
      className={`relative w-full px-2 py-1 rounded-md flex items-center gap-2 ${
        interactive
          ? "hover:bg-surface-sunken cursor-pointer"
          : "cursor-default"
      }`}
      onClick={interactive ? onToggle : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle?.();
              }
            }
          : undefined
      }
      title={
        isNative
          ? "Always shown"
          : enabled
            ? "Click to hide"
            : "Click to show"
      }
    >
      <Tooltip label="Change color" placement="right">
        <button
          type="button"
          onClick={handleSwatchClick}
          aria-label={`Change color for ${label}`}
          className={`inline-block w-2.5 h-2.5 rounded-sm transition-opacity hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 ${
            enabled ? "opacity-100" : "opacity-25"
          }`}
          style={{ backgroundColor: color }}
        />
      </Tooltip>
      <div className="flex-1 min-w-0 pointer-events-none">
        <p
          className={`text-meta font-medium truncate ${
            enabled ? "text-foreground" : "text-foreground-muted"
          }`}
        >
          {label}
        </p>
        <p className="text-meta uppercase tracking-wide text-foreground-muted">
          {description}
        </p>
      </div>
      {interactive && (
        <span
          className={`text-meta pointer-events-none ${
            enabled ? "text-foreground-muted" : "text-foreground-muted"
          }`}
        >
          {enabled ? "✓" : ""}
        </span>
      )}
      {popoverOpen && (
        <ColorPopover
          currentColor={color}
          onPick={handlePick}
          onDismiss={() => setPopoverOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Small floating popover that renders all 10 DEFAULT_CALENDAR_COLORS as a
 * 2x5 grid of clickable swatches. Anchored absolutely to its parent row
 * (no portal) so it travels with the FeedRow on layout changes. The
 * parent owns outside-click + Escape dismissal — this component just
 * surfaces user picks via `onPick`.
 */
function ColorPopover({
  currentColor,
  onPick,
}: {
  currentColor: string;
  onPick: (c: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="absolute left-1 top-6 z-50 bg-surface-raised border border-border rounded-lg shadow-lg p-2"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Choose calendar color"
    >
      <div className="grid grid-cols-5 gap-1.5">
        {DEFAULT_CALENDAR_COLORS.map((c) => {
          const selected =
            c.toLowerCase() === (currentColor || "").toLowerCase();
          return (
            <button
              key={c}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPick(c);
              }}
              aria-label={`Use color ${c}`}
              className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                selected ? "ring-2 ring-offset-1 ring-gray-500" : ""
              }`}
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>
    </div>
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
        className={`text-meta font-bold uppercase tracking-widest mb-1.5 px-1 ${
          dateStr === today ? "text-blue-600 dark:text-blue-300" : "text-foreground-muted"
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
      <Tooltip label="Jump to this day" placement="bottom">
        <button
          onClick={onClick}
          aria-label="Jump to this day"
          className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded hover:bg-surface-sunken group"
        >
          <span
            className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
            style={{ backgroundColor: color }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-meta text-foreground truncate flex items-center gap-1">
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
            <p className="text-meta text-foreground-muted mt-0.5">
              {timeLabel ?? "All-day"}
              {item.event.location && (
                <span className="ml-1 truncate">· {item.event.location}</span>
              )}
            </p>
          </div>
        </button>
      </Tooltip>
    </li>
  );
}
