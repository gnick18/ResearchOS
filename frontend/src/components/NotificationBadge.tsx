"use client";

import { useState, useEffect } from "react";
import { sharingApi } from "@/lib/local-api";
import { useLabPendingRequests } from "@/hooks/useLabPendingRequests";
import NotificationPopup from "./NotificationPopup";
import Tooltip from "./Tooltip";

interface NotificationBadgeProps {
  /** When true, render with floating white-pill chrome so the bell sits
   *  nicely on a colored header. Default keeps the transparent button. */
  pill?: boolean;
}

export default function NotificationBadge({ pill = false }: NotificationBadgeProps = {}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPopup, setShowPopup] = useState(false);
  const [, setLoading] = useState(true);
  // Fold pending lab join-requests into the bell badge so a PI sees them without
  // opening the popup. Inert (0) for non-lab-heads.
  const { count: pendingLabRequests } = useLabPendingRequests();
  const badgeCount = unreadCount + pendingLabRequests;

  // Load unread count on mount and periodically. Also listen for
  // "ros-notifications-changed" custom events so reminders fired locally
  // bump the badge instantly without waiting for the 30s poll.
  //
  // On first mount, also poll cross-user shift alerts. The `_shifted-alerts.json`
  // sidecars are written by other users (or by the current user with edit
  // permission on a shared task), and the only way for the current user to
  // discover them is at load time. `scanShiftAlerts` is idempotent (seen-id
  // dedup), so re-running on every mount is safe — but cheap to do once and
  // skip on the 30s interval to keep the poll lightweight.
  useEffect(() => {
    const init = async () => {
      try {
        await sharingApi.scanShiftAlerts();
      } catch (err) {
        // Best-effort; don't block badge mount on a sidecar read failure.
        console.warn("[shift-alerts] initial scan failed:", err);
      }
      loadUnreadCount();
    };
    void init();
    const interval = setInterval(loadUnreadCount, 30000);
    const onChange = () => loadUnreadCount();
    window.addEventListener("ros-notifications-changed", onChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener("ros-notifications-changed", onChange);
    };
  }, []);

  const loadUnreadCount = async () => {
    try {
      const response = await sharingApi.getNotifications();
      setUnreadCount(response.unread_count);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleNotificationRead = () => {
    loadUnreadCount();
  };

  return (
    <div className="relative">
      <Tooltip label="Notifications" placement="bottom">
        <button
          aria-label="Notifications"
          data-tour-target="notifications-bell"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            setShowPopup((prev) => {
              const next = !prev;
              // Refresh the badge count whenever the popup closes so reads
              // that happened inside are reflected immediately.
              if (!next) void loadUnreadCount();
              return next;
            });
          }}
          className={`relative transition-colors ${
            pill
              ? "p-1.5 bg-white/75 hover:bg-surface-raised text-foreground hover:text-foreground rounded-full shadow-sm"
              : "p-2 text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-lg"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          {badgeCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-meta font-bold rounded-full flex items-center justify-center px-1">
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </button>
      </Tooltip>

      <NotificationPopup
        isOpen={showPopup}
        onClose={() => {
          setShowPopup(false);
          // Re-sync badge count when the popup closes so any reads that
          // happened inside (including accidental ones on rapid clicks)
          // are immediately reflected rather than waiting for the 30s poll.
          void loadUnreadCount();
        }}
        onNotificationRead={handleNotificationRead}
      />
    </div>
  );
}
