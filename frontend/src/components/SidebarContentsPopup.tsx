"use client";

import { useEffect, useRef } from "react";
import Link from "@/components/FixtureLink";
import { useAppStore } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import Tooltip from "./Tooltip";
import {
  patchUserSettings,
  SIDEBAR_HORIZON_CHOICES,
} from "@/lib/settings/user-settings";

interface Props {
  onClose: () => void;
  /** Anchor element used to scope the click-outside detection so a click on
   *  the gear button (which opened the popup) doesn't immediately close it. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Quick-access popover for the DailyTasksSidebar's content toggles —
 * Show tasks, Show calendar events, and (when events are on) the
 * "How much calendar to show" horizon. Writes through patchUserSettings
 * and re-hydrates the Zustand store, mirroring how Settings → Sidebar
 * persists changes.
 */
export default function SidebarContentsPopup({ onClose, anchorRef }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const { currentUser } = useCurrentUser();

  const showTasks = useAppStore((s) => s.sidebarShowTasks);
  const showEvents = useAppStore((s) => s.sidebarShowCalendarEvents);
  const horizonDays = useAppStore((s) => s.sidebarEventsHorizonDays);
  const hydrateFromSettings = useAppStore((s) => s.hydrateFromSettings);

  // Close on outside click + Escape.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!popupRef.current) return;
      if (popupRef.current.contains(e.target as Node)) return;
      if (anchorRef?.current && anchorRef.current.contains(e.target as Node)) {
        // Let the anchor button's onClick toggle the popup itself.
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  const save = async (
    patch: Partial<{
      sidebarShowTasks: boolean;
      sidebarShowCalendarEvents: boolean;
      sidebarEventsHorizonDays: number;
    }>,
  ) => {
    if (!currentUser) return;
    const saved = await patchUserSettings(currentUser, patch);
    hydrateFromSettings({
      animationType: saved.animationType,
      viewMode: saved.defaultGanttViewMode,
      calendarViewMode: saved.defaultCalendarViewMode,
      showShared: saved.showSharedByDefault,
      visibleTabs: saved.visibleTabs,
      defaultLandingTab: saved.defaultLandingTab,
      sidebarShowTasks: saved.sidebarShowTasks,
      sidebarShowCalendarEvents: saved.sidebarShowCalendarEvents,
      sidebarEventsHorizonDays: saved.sidebarEventsHorizonDays,
      coloredHeader: saved.coloredHeader,
      offlineMode: saved.offlineMode,
    });
  };

  const bothOff = !showTasks && !showEvents;

  return (
    <div
      ref={popupRef}
      className="absolute left-full top-0 ml-2 w-72 bg-surface-raised rounded-xl shadow-xl border border-border z-50 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border bg-surface-sunken flex items-center justify-between">
        <h3 className="text-body font-semibold text-foreground">Sidebar contents</h3>
        <Tooltip label="Close" placement="bottom">
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground-muted text-title"
          >
            ✕
          </button>
        </Tooltip>
      </div>

      <div className="p-4 space-y-3">
        <label className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border hover:bg-surface-sunken cursor-pointer">
          <input
            type="checkbox"
            checked={showTasks}
            onChange={(e) => void save({ sidebarShowTasks: e.target.checked })}
            className="accent-blue-600"
          />
          <span className="text-meta text-foreground">Tasks</span>
          <span className="ml-auto text-meta text-foreground-muted">
            today · overdue · upcoming
          </span>
        </label>

        <label className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border hover:bg-surface-sunken cursor-pointer">
          <input
            type="checkbox"
            checked={showEvents}
            onChange={(e) =>
              void save({ sidebarShowCalendarEvents: e.target.checked })
            }
            className="accent-blue-600"
          />
          <span className="text-meta text-foreground">Calendar events</span>
          <span className="ml-auto text-meta text-foreground-muted">today and beyond</span>
        </label>

        <div className={showEvents ? "" : "opacity-50 pointer-events-none"}>
          <label className="block text-meta font-medium text-foreground-muted mb-1">
            How much calendar to show
          </label>
          <select
            value={horizonDays}
            disabled={!showEvents}
            onChange={(e) =>
              void save({ sidebarEventsHorizonDays: parseInt(e.target.value, 10) })
            }
            className="w-full px-2 py-1.5 border border-border rounded-md text-meta bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-surface-sunken"
          >
            {SIDEBAR_HORIZON_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {bothOff && (
          <p className="text-meta text-amber-600">
            Both off — the sidebar will be empty.
          </p>
        )}
      </div>

      <div className="px-4 py-2 border-t border-border bg-surface-sunken flex items-center justify-between">
        <Link
          href="/settings"
          onClick={onClose}
          className="text-meta text-blue-600 hover:underline"
        >
          Open full settings →
        </Link>
        <span className="text-meta text-foreground-muted">Auto-saves</span>
      </div>
    </div>
  );
}
