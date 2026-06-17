"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { sharingApi } from "@/lib/local-api";
import { useCalendarNavStore } from "@/lib/calendar/calendar-nav-store";
import { useLabPendingRequests } from "@/hooks/useLabPendingRequests";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import Tooltip from "./Tooltip";
import type {
  LabAnnouncementNotification,
  LabCommentNotification,
  LabFlagForReviewNotification,
  LabPurchaseApprovalNotification,
  LabTaskAssignmentNotification,
  Notification,
  PurchaseAssignmentNotification,
  PurchaseOrderedNotification,
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
  // Pending lab join-requests are surfaced as a light pinned banner (not a
  // persisted store notification) so a PI sees them in the bell without the
  // heavy notification-record machinery. Inert for non-lab-heads (count 0).
  const { count: pendingLabRequests } = useLabPendingRequests();
  const jumpTo = useCalendarNavStore((s) => s.jumpTo);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Escape closes this popup (app-wide convention). Only bound while open.
  useEscapeToClose(onClose, isOpen);

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
      role="menu"
      className="absolute right-0 top-full mt-2 w-96 bg-surface-raised rounded-xl shadow-xl border border-border z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-border bg-surface-sunken">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 text-meta font-normal text-foreground-muted">
                ({unreadCount} unread)
              </span>
            )}
          </h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              data-tour-secondary-anchor="notification-silence"
              className="text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium tour-secondary-pulse"
            >
              Mark all read
            </button>
          )}
        </div>
        {notifications.length > 0 && (
          <div className="mt-1.5 flex items-center justify-end gap-3 text-meta">
            {notifications.some((n) => n.read) && (
              <button
                onClick={handleClearRead}
                className="text-foreground-muted hover:text-foreground"
                title="Remove notifications already marked read"
              >
                Clear read
              </button>
            )}
            <button
              onClick={handleClearAll}
              className="text-red-500 hover:text-red-700 dark:hover:text-red-300"
              title="Remove every notification"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Pending lab join-requests: a pinned banner above the notification list
          (lab head only; routes to the Members roster to approve). */}
      {pendingLabRequests > 0 && (
        <button
          type="button"
          onClick={() => {
            router.push("/settings?section=members");
            onClose();
          }}
          className="flex w-full items-center gap-3 border-b border-border bg-blue-50 dark:bg-blue-500/10 px-4 py-3 text-left transition-colors hover:bg-blue-100 dark:hover:bg-blue-500/20"
        >
          <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-red-500 px-1.5 text-meta font-bold text-white">
            {pendingLabRequests > 99 ? "99+" : pendingLabRequests}
          </span>
          <span className="text-body text-foreground">
            {pendingLabRequests === 1
              ? "1 pending lab join request"
              : `${pendingLabRequests} pending lab join requests`}
            <span className="block text-meta text-foreground-muted">
              Open Members to review and approve
            </span>
          </span>
        </button>
      )}

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center text-foreground-muted">
            <svg className="w-12 h-12 mx-auto mb-2 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-body">No notifications</p>
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
              // Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23):
              // bell types for the soft-write quartet — announcement,
              // assignment, approval, flag-for-review.
              const isLabPhase3 =
                notification.type === "lab_announcement" ||
                notification.type === "lab_task_assignment" ||
                notification.type === "lab_purchase_approval" ||
                notification.type === "lab_flag_for_review";
              // Lab-manager ordering workflow (purchases-assignee fix,
              // 2026-05-29): the trainee -> lab-member ordering handoff
              // bells. `purchase_assignment` lands on the assignee;
              // `purchase_ordered` lands on the requester.
              const isPurchaseFlow =
                notification.type === "purchase_assignment" ||
                notification.type === "purchase_ordered";
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
                // is the Lab Overview comments feed — the inline source-
                // surface link there lets the user jump to the underlying
                // record. Lab Overview is the single feed where every
                // cross-lab comment lives, so it's a natural landing spot
                // for the bell click. (Renamed from "Lab Inbox" 2026-05-23
                // — lab overview rename manager.) Mark read + close before
                // navigating.
                if (!notification.read) {
                  void handleMarkRead(notification.id);
                }
                router.push("/lab-overview");
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
                  className={`relative p-3 hover:bg-surface-sunken transition-colors cursor-pointer ${
                    !notification.read
                      ? "bg-blue-50 dark:bg-blue-500/10 border-l-4 border-blue-500 pl-2"
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
                        notification.read ? "bg-surface-sunken text-foreground-muted" : "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300"
                      }`}
                    >
                      {isReminder
                        ? getReminderIcon()
                        : isShiftAlert
                          ? getShiftAlertIcon()
                          : isLabComment
                            ? getLabCommentIcon()
                            : isLabPhase3
                              ? getLabPhase3Icon(notification.type)
                              : isPurchaseFlow
                                ? getPurchaseFlowIcon(notification.type)
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
                            className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
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
                              className="text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
                            >
                              View task →
                            </button>
                            <button
                              onClick={handleDismissShiftAlert}
                              className="text-meta text-foreground-muted hover:text-foreground font-medium"
                            >
                              Ignore
                            </button>
                          </div>
                        </>
                      ) : notification.type === "task_shared" ||
                          notification.type === "method_shared" ||
                          notification.type === "project_shared" ? (
                        <>
                          <p className="text-body text-foreground">
                            <span className="font-medium">{notification.from_user}</span>
                            {" shared "}
                            <span className="font-medium">{notification.item_name}</span>
                            {" with you"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-meta text-foreground-muted">
                              {formatTime(notification.created_at)}
                            </span>
                            <span className="text-meta text-foreground-muted">•</span>
                            <span className="text-meta text-foreground-muted">
                              {notification.permission === "edit" ? "Can edit" : "Can view"}
                            </span>
                          </div>
                        </>
                      ) : isLabPhase3 ? (
                        // Lab Head Phase 3 (lab head Phase 3 manager,
                        // 2026-05-23): announcement / assignment /
                        // approval / flag-for-review.
                        <LabPhase3Row
                          notification={notification as
                            | LabAnnouncementNotification
                            | LabTaskAssignmentNotification
                            | LabPurchaseApprovalNotification
                            | LabFlagForReviewNotification}
                          onMarkRead={() => handleMarkRead(notification.id)}
                          onNavigate={() => {
                            if (!notification.read) {
                              void handleMarkRead(notification.id);
                            }
                            onClose();
                          }}
                        />
                      ) : isPurchaseFlow ? (
                        // Lab-manager ordering workflow (purchases-assignee
                        // fix, 2026-05-29): assignment / ordered bells.
                        <PurchaseFlowRow
                          notification={notification as
                            | PurchaseAssignmentNotification
                            | PurchaseOrderedNotification}
                          onNavigate={() => {
                            if (!notification.read) {
                              void handleMarkRead(notification.id);
                            }
                            onClose();
                          }}
                        />
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
                            className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
                          >
                            Open in Lab Overview →
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
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 hover:bg-blue-200 text-meta font-medium border border-blue-200 dark:border-blue-500/30"
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
                          className="text-foreground-muted hover:text-red-500 transition-colors"
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
      <p className="text-body text-foreground">
        <span className="font-medium">{notification.event_title}</span>
        <span className="text-foreground-muted"> in {notification.offset_minutes} min</span>
      </p>
      <div className="flex items-center gap-2 mt-1 text-meta text-foreground-muted">
        <span>{timeLabel}</span>
        {notification.event_location && (
          <>
            <span className="text-foreground-muted">•</span>
            <span className="truncate">{notification.event_location}</span>
          </>
        )}
        {notification.event_kind === "external" && (
          <>
            <span className="text-foreground-muted">•</span>
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
      <p className="text-body text-foreground">
        <span className="font-medium">{notification.from_user}</span>
        {" shifted "}
        <span className="font-medium">{notification.item_name}</span>
        {" by "}
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-meta font-semibold align-baseline">
          {headlineDelta}
        </span>
      </p>
      <p className="text-meta text-foreground-muted mt-0.5">
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
      <p className="text-body text-foreground">
        <span className="font-medium">{notification.from_user}</span>
        {" "}
        {headline}
        {" "}
        {notification.type === "comment_lab_head_feed" && `${notification.owner_username}'s `}
        {recordNoun}{" "}
        <span className="font-medium">{notification.record_name}</span>
      </p>
      {notification.preview && (
        <p className="text-meta text-foreground-muted mt-1 line-clamp-2">
          {notification.preview}
        </p>
      )}
    </>
  );
}

// Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): icon picker
// for the soft-write quartet. Each subtype uses a distinct glyph so a PI
// scanning the inbox can tell at a glance which surface fired.
function getLabPhase3Icon(
  type:
    | "lab_announcement"
    | "lab_task_assignment"
    | "lab_purchase_approval"
    | "lab_flag_for_review"
    | string,
) {
  if (type === "lab_announcement") {
    // Megaphone — lab-wide broadcast.
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5l-7 4v6l7 4V5zM15 9v6m4-8v10" />
      </svg>
    );
  }
  if (type === "lab_task_assignment") {
    // User-plus — assignment.
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth={2} fill="none" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 8v6M22 11h-6" />
      </svg>
    );
  }
  if (type === "lab_purchase_approval") {
    // Checkmark in circle — approved.
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} fill="none" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12l3 3 5-6" />
      </svg>
    );
  }
  // lab_flag_for_review — flag.
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 22V4a2 2 0 0 1 2-2h8l2 4h4v10h-6l-2-4H6v10" />
    </svg>
  );
}

interface LabPhase3RowProps {
  notification:
    | LabAnnouncementNotification
    | LabTaskAssignmentNotification
    | LabPurchaseApprovalNotification
    | LabFlagForReviewNotification;
  onMarkRead: () => void;
  onNavigate: () => void;
}

function LabPhase3Row({ notification, onMarkRead, onNavigate }: LabPhase3RowProps) {
  const router = useRouter();
  void onMarkRead;
  const { from_user } = notification;

  if (notification.type === "lab_announcement") {
    return (
      <>
        <p className="text-body text-foreground">
          <span className="font-medium">{from_user}</span>
          {" posted a lab announcement"}
        </p>
        {notification.preview && (
          <p className="text-meta text-foreground-muted mt-1 line-clamp-2">{notification.preview}</p>
        )}
        <button
          onClick={() => {
            router.push("/lab-overview");
            onNavigate();
          }}
          className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
        >
          Open Lab Overview →
        </button>
      </>
    );
  }

  if (notification.type === "lab_task_assignment") {
    return (
      <>
        <p className="text-body text-foreground">
          <span className="font-medium">{from_user}</span>
          {" assigned you a task: "}
          <span className="font-medium">{notification.task_name}</span>
        </p>
        {notification.note && (
          <p className="text-meta text-foreground-muted mt-1 line-clamp-2">{notification.note}</p>
        )}
        <button
          onClick={() => {
            // Deep-linking to a foreign owner's individual task popup
            // isn't a robust route yet (mirrors the shift-alert handler's
            // comment). Route to Lab Overview so the user can find the
            // task via the existing surfaces.
            router.push("/lab-overview");
            onNavigate();
          }}
          className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
        >
          Open Lab Overview →
        </button>
      </>
    );
  }

  if (notification.type === "lab_purchase_approval") {
    return (
      <>
        <p className="text-body text-foreground">
          <span className="font-medium">{from_user}</span>
          {" approved your purchase: "}
          <span className="font-medium">{notification.item_name}</span>
        </p>
        <button
          onClick={() => {
            router.push("/purchases");
            onNavigate();
          }}
          className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
        >
          View purchase →
        </button>
      </>
    );
  }

  // lab_flag_for_review
  const recordNoun =
    notification.record_type === "task"
      ? "task"
      : notification.record_type === "note"
        ? "note"
        : "purchase item";
  return (
    <>
      <p className="text-body text-foreground">
        <span className="font-medium">{from_user}</span>
        {" flagged your "}
        {recordNoun}
        {": "}
        <span className="font-medium">{notification.record_name}</span>
      </p>
      {notification.reason && (
        <p className="text-meta text-foreground-muted mt-1 line-clamp-2">{notification.reason}</p>
      )}
      <button
        onClick={() => {
          // Route to the surface that hosts the record type. Notes /
          // tasks live in Lab Mode; purchase items live in /purchases.
          if (notification.record_type === "purchase_item") {
            router.push("/purchases");
          } else if (notification.record_type === "note") {
            router.push("/workbench?tab=notes");
          } else {
            router.push("/lab-overview");
          }
          onNavigate();
        }}
        className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
      >
        Open record →
      </button>
    </>
  );
}

// Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29):
// icon picker for the two ordering-handoff bells. `purchase_assignment`
// uses a cart glyph ("please order this"); `purchase_ordered` uses a
// package glyph ("it shipped / was ordered").
function getPurchaseFlowIcon(type: "purchase_assignment" | "purchase_ordered" | string) {
  if (type === "purchase_ordered") {
    // Package box — the supply was ordered.
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    );
  }
  // purchase_assignment — shopping cart.
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-8 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
    </svg>
  );
}

interface PurchaseFlowRowProps {
  notification: PurchaseAssignmentNotification | PurchaseOrderedNotification;
  onNavigate: () => void;
}

function PurchaseFlowRow({ notification, onNavigate }: PurchaseFlowRowProps) {
  const router = useRouter();
  const { from_user } = notification;

  if (notification.type === "purchase_assignment") {
    return (
      <>
        <p className="text-body text-foreground">
          <span className="font-medium">{from_user}</span>
          {" asked you to order: "}
          <span className="font-medium">{notification.item_name}</span>
        </p>
        <button
          onClick={() => {
            router.push("/purchases");
            onNavigate();
          }}
          className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
        >
          View purchase →
        </button>
      </>
    );
  }

  // purchase_ordered — the requester learns their supply was ordered.
  return (
    <>
      <p className="text-body text-foreground">
        {"Your supply "}
        <span className="font-medium">{notification.item_name}</span>
        {" was ordered"}
        {from_user ? (
          <>
            {" by "}
            <span className="font-medium">{from_user}</span>
          </>
        ) : null}
      </p>
      <button
        onClick={() => {
          router.push("/purchases");
          onNavigate();
        }}
        className="mt-1.5 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
      >
        View purchase →
      </button>
    </>
  );
}
