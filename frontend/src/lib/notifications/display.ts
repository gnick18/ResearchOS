// Shared, framework-free display text for a notification (title + one-line body).
//
// One source of truth for "how a notification reads" so every push channel
// renders it the same way: the laptop desktop pop-up (NotificationDesktopWatcher),
// the email body (notification-mailer), and the phone snapshot
// (mobile-relay/notifications-snapshot). Pure, no React, no I/O.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { notificationCategory } from "@/lib/notifications/preferences";
import type { Notification as RosNotification } from "@/lib/types";

const CATEGORY_TITLES: Record<string, string> = {
  shared: "Shared with you",
  comments: "New comment",
  lab: "Lab announcement",
  purchases: "Purchase update",
  reminders: "Reminder",
};

/**
 * A short category title plus the notification's own one-line body, picked from
 * whichever of the known content fields is present. Falls back to a generic
 * "open ResearchOS" body so a snapshot or pop-up is never blank.
 */
export function notificationDisplayText(n: RosNotification): {
  title: string;
  body: string;
} {
  const r = n as unknown as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  };
  const title = CATEGORY_TITLES[notificationCategory(n.type)] ?? "ResearchOS";
  const body =
    pick("message", "preview", "item_name", "event_title", "title", "note") ||
    "Open ResearchOS to see it.";
  return { title, body };
}
