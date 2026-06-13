"use client";

import { useEffect, useRef } from "react";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { sharingApi } from "@/lib/local-api";
import { readUserSettings } from "@/lib/settings/user-settings";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  notificationCategory,
  pushChannelsForNotification,
} from "@/lib/notifications/preferences";
import type { Notification as RosNotification } from "@/lib/types";

/**
 * The push-channel dispatcher for the notification-preferences feature: turn a
 * NEW notification into a real laptop desktop pop-up (the browser Notification
 * API, phase 1c) and/or an email to the user's own inbox (phase 2, account
 * users), gated on the per-category preference, quiet hours, and (for laptop)
 * the granted permission. Headless; mounted once in AppShell.
 *
 * It rides the same cadence as the bell (a 30s poll plus the
 * ros-notifications-changed event). On first read after mount it SEEDS the seen
 * set with everything already present so a fresh load never blasts a backlog of
 * pop-ups; only notifications that arrive while a tab is open fire. That "while
 * a tab is open" limit is inherent to the local-first laptop channel; email and
 * phone (later phases) cover the away case.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */
function desktopText(n: RosNotification): { title: string; body: string } {
  const titles: Record<string, string> = {
    shared: "Shared with you",
    comments: "New comment",
    lab: "Lab announcement",
    purchases: "Purchase update",
    reminders: "Reminder",
  };
  const r = n as unknown as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return "";
  };
  const title = titles[notificationCategory(n.type)] ?? "ResearchOS";
  const body =
    pick("message", "preview", "item_name", "event_title", "title", "note") ||
    "Open ResearchOS to see it.";
  return { title, body };
}

export default function NotificationDesktopWatcher() {
  const { currentUser } = useFileSystem();
  const { status } = useSharingIdentity();
  const hasAccount = status === "ready";

  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    if (!currentUser) return;
    if (typeof Notification === "undefined") return;

    // Reset per user: a folder/user switch starts a fresh seen set.
    seen.current = new Set();
    seeded.current = false;
    let cancelled = false;

    const process = async () => {
      let prefs;
      try {
        const settings = await readUserSettings(currentUser);
        prefs = normalizeNotificationPreferences(
          settings.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
        );
      } catch {
        return;
      }
      let list: RosNotification[];
      try {
        list = (await sharingApi.getNotifications()).notifications ?? [];
      } catch {
        return;
      }
      if (cancelled) return;

      const firstSeed = !seeded.current;
      const now = new Date();
      for (const n of list) {
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        // Never fire for notifications that already existed at mount, or for
        // ones already read.
        if (firstSeed || n.read) continue;
        const ch = pushChannelsForNotification(prefs, n.type, now, hasAccount);
        if (!ch.laptop && !ch.email) continue;
        const { title, body } = desktopText(n);
        if (ch.laptop && Notification.permission === "granted") {
          try {
            new Notification(title, { body, tag: n.id });
          } catch {
            // Some browsers throw if invoked outside a user gesture / SW; ignore.
          }
        }
        if (ch.email && prefs.email) {
          // The recipient emails their OWN address (set in Settings, account
          // users only). Fire and forget; a delivery failure must never break
          // the watcher loop.
          void fetch("/api/notify-email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ to: prefs.email, title, body }),
          }).catch(() => {});
        }
      }
      seeded.current = true;
    };

    void process();
    const interval = setInterval(() => void process(), 30000);
    const onChange = () => void process();
    window.addEventListener("ros-notifications-changed", onChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("ros-notifications-changed", onChange);
    };
  }, [currentUser, hasAccount]);

  return null;
}
