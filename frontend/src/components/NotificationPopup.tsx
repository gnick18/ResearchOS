"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { sharingApi } from "@/lib/local-api";
import { useCalendarNavStore } from "@/lib/calendar/calendar-nav-store";
import Tooltip from "./Tooltip";
import type {
  LabCommentNotification,
  Notification,
  ShiftAlertNotification,
} from "@/lib/types";

interface NotificationPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onNotificationRead: () => void;
}

export default function NotificationPopup({
  isOpen,
  onClose,
  onNotificationRead,
}: NotificationPopupProps) {
  const router = useRouter();
  const jumpTo = useCalendarNavStore((s) => s.jumpTo);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
      // Onboarding v4 §6.3: the bell sub-step listens for this event
      // so the silence sub-step's spotlight only mounts after the
      // popup is actually visible. Cheap dispatch regardless of
      // listeners; no-op outside a tour.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("tour:notifications-popup-opened"),
        );
      }
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const response = await sharingApi.getNotifications();
      setNotifications(response.notifications);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    try {
      await sharingApi.markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      onNotificationRead();
      // Onboarding v4 §6.3 silence sub-step listens for this. Fires
      // for both the explicit "Mark as read" button and the row-body
      // click path (both flow through this handler), so the tour
      // advances on either user action.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("tour:notification-silenced", {
            detail: { id: notificationId },
          }),
        );
      }
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await sharingApi.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      onNotificationRead();
      // Onboarding v4 §6.3 silence sub-step also advances on Mark-all-read.
      // Grant flagged that clicking the header link should count: the
      // tour cares about "the user silenced a notification," not which
      // specific button they used. Detail kind lets analytics differ.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("tour:notification-silenced", {
            detail: { kind: "all" },
          }),
        );
      }
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
    }
  };

  const handleDismiss = async (notificationId: string) => {
    try {
      await sharingApi.dismissNotification(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      onNotificationRead();
      window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
      // Onboarding v4 §6.3 delete sub-step listens for this. The
      // bell-badge change event above keeps the badge count fresh;
      // this dedicated event lets the tour controller distinguish a
      // dismiss action from any other notifications-list mutation.
      window.dispatchEvent(
        new CustomEvent("tour:notification-deleted", {
          detail: { id: notificationId },
        }),
      );
    } catch (err) {
      console.error("Failed to dismiss notification:", err);
    }
  };

  const handleClearAll = async () => {
    const ok = window.confirm(
      "Clear all notifications? Unread items will be removed too."
    );
    if (!ok) return;
    try {
      await sharingApi.dismissAllNotifications();
      setNotifications([]);
      onNotificationRead();
      window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
    } catch (err) {
      console.error("Failed to clear notifications:", err);
    }
  };

  const handleClearRead = async () => {
    try {
      await sharingApi.dismissReadNotifications();
      setNotifications((prev) => prev.filter((n) => !n.read));
      onNotificationRead();
      window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
    } catch (err) {
      console.error("Failed to clear read notifications:", err);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getItemTypeIcon = (itemType: string) => {
    switch (itemType) {
      case "task":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        );
      case "method":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      case "project":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        );
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      ref={popupRef}
      className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                ({unreadCount} unread)
              </span>
            )}
          </h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              data-tour-secondary-anchor="notification-silence"
              className="text-xs text-blue-600 hover:text-blue-800 font-medium tour-secondary-pulse"
            >
              Mark all read
            </button>
          )}
        </div>
        {notifications.length > 0 && (
          <div className="mt-1.5 flex items-center justify-end gap-3 text-[11px]">
            {notifications.some((n) => n.read) && (
              <button
                onClick={handleClearRead}
                className="text-gray-500 hover:text-gray-700"
                title="Remove notifications already marked read"
              >
                Clear read
              </button>
            )}
            <button
              onClick={handleClearAll}
              className="text-red-500 hover:text-red-700"
              title="Remove every notification"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {notifications.map((notification) => {
              const isReminder = notification.type === "event_reminder";
              const isShiftAlert = notification.type === "shift_alert";
              const isLabComment =
                notification.type === "comment_mention" ||
                notification.type === "comment_on_owned" ||
                notification.type === "comment_lab_head_feed";
              // Row click only acknowledges the entry — never navigates and
              // never closes the popup. Navigation lives on an explicit
              // "Open in calendar" link inside reminder rows (or "View task"
              // inside shift-alert rows).
              const handleClickRow = () => {
                if (!notification.read) {
                  void handleMarkRead(notification.id);
                }
              };
              const handleOpenReminder = (e: React.MouseEvent) => {
                e.stopPropagation();
                if (notification.type !== "event_reminder") return;
                jumpTo("day", notification.event_date);
                router.push("/calendar");
                if (!notification.read) {
                  void handleMarkRead(notification.id);
                }
                onClose();
              };
              const handleViewShiftedTask = (e: React.MouseEvent) => {
                e.stopPropagation();
                if (notification.type !== "shift_alert") return;
                // Deep-link to the day-view of the new start date so the
                // user sees the task in context. The TaskDetailPopup will
                // be opened by Grant clicking the task chip — for v1 we
                // skip auto-opening because the task may be in someone
                // else's namespace and we don't have a robust shared-task
                // direct-link route today.
                jumpTo("day", notification.new_start);
                router.push("/calendar");
                if (!notification.read) {
                  void handleMarkRead(notification.id);
                }
                onClose();
              };
              const handleOpenLabComment = (e: React.MouseEvent) => {
                e.stopPropagation();
                if (
                  notification.type !== "comment_mention" &&
                  notification.type !== "comment_on_owned" &&
                  notification.type !== "comment_lab_head_feed"
                ) {
                  return;
                }
                // For Phase 2 the comment notification's deep-link target
                // is the Lab Inbox feed — the inline source-surface link
                // there lets the user jump to the underlying record. The
                // Lab Inbox is the single feed where every cross-lab
                // comment lives, so it's a natural landing spot for the
                // bell click. Mark read + close before navigating.
                if (!notification.read) {
                  void handleMarkRead(notification.id);
                }
                router.push("/lab-inbox");
                onClose();
              };
              const handleDismissShiftAlert = async (e: React.MouseEvent) => {
                e.stopPropagation();
                if (notification.type !== "shift_alert") return;
                try {
                  await sharingApi.dismissShiftAlert(notification.id);
                  setNotifications((prev) =>
                    prev.filter((n) => n.id !== notification.id)
                  );
                  onNotificationRead();
                  window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
                } catch (err) {
                  console.error("Failed to dismiss shift alert:", err);
                }
              };
              return (
                <div
                  key={notification.id}
                  onClick={handleClickRow}
                  className={`relative p-3 hover:bg-gray-50 transition-colors cursor-pointer ${
                    !notification.read
                      ? "bg-blue-50 border-l-4 border-blue-500 pl-2"
                      : "border-l-4 border-transparent"
                  }`}
                  title={
                    notification.read
                      ? undefined
                      : "Click anywhere to mark as read"
                  }
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                        notification.read ? "bg-gray-100 text-gray-500" : "bg-blue-100 text-blue-600"
                      }`}
                    >
                      {isReminder
                        ? getReminderIcon()
                        : isShiftAlert
                          ? getShiftAlertIcon()
                          : isLabComment
                            ? getLabCommentIcon()
                            : notification.type === "task_shared" ||
                                notification.type === "method_shared" ||
                                notification.type === "project_shared"
                              ? getItemTypeIcon(notification.item_type)
                              : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      {notification.type === "event_reminder" ? (
                        <>
                          <ReminderBody notification={notification} />
                          <button
                            onClick={handleOpenReminder}
                            className="mt-1.5 text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Open in calendar →
                          </button>
                        </>
                      ) : notification.type === "shift_alert" ? (
                        <>
                          <ShiftAlertBody notification={notification} />
                          <div className="mt-1.5 flex items-center gap-3">
                            <button
                              onClick={handleViewShiftedTask}
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                            >
                              View task →
                            </button>
                            <button
                              onClick={handleDismissShiftAlert}
                              className="text-[11px] text-gray-500 hover:text-gray-700 font-medium"
                            >
                              Ignore
                            </button>
                          </div>
                        </>
                      ) : notification.type === "task_shared" ||
                          notification.type === "method_shared" ||
                          notification.type === "project_shared" ? (
                        <>
                          <p className="text-sm text-gray-900">
                            <span className="font-medium">{notification.from_user}</span>
                            {" shared "}
                            <span className="font-medium">{notification.item_name}</span>
                            {" with you"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">
                              {formatTime(notification.created_at)}
                            </span>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-500">
                              {notification.permission === "edit" ? "Can edit" : "Can view"}
                            </span>
                          </div>
                        </>
                      ) : (
                        // Remaining notification family is the Lab Head
                        // Phase 2 comment-feed trio (comment_mention /
                        // comment_on_owned / comment_lab_head_feed). TS's
                        // narrowing of the negated `task_shared | method_shared
                        // | project_shared` disjunction above doesn't drop
                        // SharedItemNotification cleanly, so we re-narrow
                        // explicitly here.
                        <>
                          <LabCommentBody notification={notification as LabCommentNotification} />
                          <button
                            onClick={handleOpenLabComment}
                            className="mt-1.5 text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Open in Lab Inbox →
                          </button>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {!notification.read && (
                        <Tooltip label="Mark as read" placement="left">
                          <button
                            data-tour-target="notification-silence"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkRead(notification.id);
                            }}
                            aria-label="Mark as read"
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-medium border border-blue-200"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Mark read</span>
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip label="Dismiss" placement="left">
                        <button
                          data-tour-target="notification-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDismiss(notification.id);
                          }}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function getReminderIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ReminderBody({
  notification,
}: {
  notification: import("@/lib/types").EventReminderNotification;
}) {
  const startMs = Date.parse(notification.event_start_iso);
  const startDate = isFinite(startMs) ? new Date(startMs) : null;
  const timeLabel = startDate
    ? startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  return (
    <>
      <p className="text-sm text-gray-900">
        <span className="font-medium">{notification.event_title}</span>
        <span className="text-gray-500"> in {notification.offset_minutes} min</span>
      </p>
      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
        <span>{timeLabel}</span>
        {notification.event_location && (
          <>
            <span className="text-gray-400">•</span>
            <span className="truncate">{notification.event_location}</span>
          </>
        )}
        {notification.event_kind === "external" && (
          <>
            <span className="text-gray-400">•</span>
            <span>Linked</span>
          </>
        )}
      </div>
    </>
  );
}

function getShiftAlertIcon() {
  // Calendar with a circular-arrow overlay — "scheduled date moved".
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M14 14l2 2-2 2m2-2H10"
      />
    </svg>
  );
}

function ShiftAlertBody({
  notification,
}: {
  notification: ShiftAlertNotification;
}) {
  // Use start_delta as the headline; UI says "+3d" / "-1d" / "+0d (end +2d)"
  // (the last form covers duration-only changes if they're ever surfaced).
  const startDelta = notification.start_delta_days;
  const endDelta = notification.end_delta_days;
  const formatDelta = (d: number): string => (d > 0 ? `+${d}d` : `${d}d`);
  const headlineDelta = startDelta !== 0 ? formatDelta(startDelta) : formatDelta(endDelta);
  return (
    <>
      <p className="text-sm text-gray-900">
        <span className="font-medium">{notification.from_user}</span>
        {" shifted "}
        <span className="font-medium">{notification.item_name}</span>
        {" by "}
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold align-baseline">
          {headlineDelta}
        </span>
      </p>
      <p className="text-xs text-gray-600 mt-0.5">
        {notification.old_start} → <span className="font-medium">{notification.new_start}</span>
        {startDelta !== endDelta && (
          <>
            {"  ·  end "}
            {notification.old_end} → <span className="font-medium">{notification.new_end}</span>
          </>
        )}
      </p>
    </>
  );
}

// Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): icon + body for
// the `comment_mention` / `comment_on_owned` / `comment_lab_head_feed`
// notification family. All three render the same row layout but the
// headline copy differs so a lab head scanning the inbox can immediately
// tell why each notification fired.
function getLabCommentIcon() {
  // Speech-bubble outline — same visual lineage as the in-record comment
  // section header so the bell row is recognizable.
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z"
      />
    </svg>
  );
}

function LabCommentBody({
  notification,
}: {
  notification: LabCommentNotification;
}) {
  const headline =
    notification.type === "comment_mention"
      ? "mentioned you in"
      : notification.type === "comment_on_owned"
        ? "commented on your"
        : "commented on";
  const recordNoun = notification.record_type === "task" ? "task" : "note";
  return (
    <>
      <p className="text-sm text-gray-900">
        <span className="font-medium">{notification.from_user}</span>
        {" "}
        {headline}
        {" "}
        {notification.type === "comment_lab_head_feed" && `${notification.owner_username}'s `}
        {recordNoun}{" "}
        <span className="font-medium">{notification.record_name}</span>
      </p>
      {notification.preview && (
        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
          {notification.preview}
        </p>
      )}
    </>
  );
}
