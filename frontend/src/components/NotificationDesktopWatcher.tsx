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
  type NotificationPreferences,
} from "@/lib/notifications/preferences";
import { notificationDisplayText } from "@/lib/notifications/display";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { publishNotificationsToAllDevices } from "@/lib/mobile-relay/notifications-snapshot";
import type { Notification as RosNotification } from "@/lib/types";

/**
 * The push-channel dispatcher for the notification-preferences feature: turn a
 * NEW notification into a real laptop desktop pop-up (the browser Notification
 * API, phase 1c), an email to the user's own inbox (phase 2, account users),
 * and/or a phone buzz (phone push P1, account users with a paired phone), gated
 * on the per-category preference, quiet hours, and (for laptop) the granted
 * permission. Headless; mounted once in AppShell.
 *
 * It rides the same cadence as the bell (a 30s poll plus the
 * ros-notifications-changed event). On first read after mount it SEEDS the seen
 * set with everything already present so a fresh load never blasts a backlog of
 * pop-ups; only notifications that arrive while a tab is open fire. That "while
 * a tab is open" limit is inherent to the local-first laptop channel; email and
 * phone push cover part of the away case, and the laptop-CLOSED case is the
 * later P2 relay work.
 *
 * Phone push is wake-and-fetch: when a new phone-routed notification lands, we
 * publish the freshly sealed snapshot to the relay (so the content is ready to
 * fetch) and then POST the paired devices' Expo push tokens to /api/send-push,
 * which sends a GENERIC, content-free buzz. The phone wakes and decrypts the
 * snapshot it already reads. Multiple new phone-routed notifications in one poll
 * collapse into a single buzz so a backlog never machine-guns the phone.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */
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
      let prefs: NotificationPreferences;
      let autoPublishToPhones = false;
      try {
        const settings = await readUserSettings(currentUser);
        prefs = normalizeNotificationPreferences(
          settings.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
        );
        // The same master kill switch the snapshot publisher honors. Off means no
        // phone delivery at all (the sealed snapshot is never published, so a
        // wake-and-fetch buzz would find nothing to read); respect it for push too.
        autoPublishToPhones = !!settings.autoPublishSnapshotsToPhones;
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
      // Collapse every new phone-routed notification in this poll into a single
      // buzz; the most recent one's category is the generic hint. We carry only
      // the coarse category, never any notification content.
      let phoneRoutedNew = 0;
      let phoneCategory = "";
      for (const n of list) {
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        // Never fire for notifications that already existed at mount, or for
        // ones already read.
        if (firstSeed || n.read) continue;
        const ch = pushChannelsForNotification(prefs, n.type, now, hasAccount);
        if (ch.phone) {
          phoneRoutedNew += 1;
          phoneCategory = notificationCategory(n.type);
        }
        if (!ch.laptop && !ch.email) continue;
        const { title, body } = notificationDisplayText(n);
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

      // Phone push (P1). One generic, content-free buzz for the batch. Account +
      // quiet-hours + per-category gating already happened above (ch.phone is
      // only true for an account user inside an allowed category outside quiet
      // hours); the master auto-publish kill switch is the last gate. We publish
      // the sealed snapshot first so the woken phone has fresh content to fetch,
      // then send the buzz to exactly the devices that received it. Fire and
      // forget; a missed buzz is never a failure state (the synced list still
      // carries it).
      if (phoneRoutedNew > 0 && autoPublishToPhones && !cancelled) {
        void firePhonePush(prefs, phoneCategory);
      }
    };

    const firePhonePush = async (
      prefs: NotificationPreferences,
      category: string,
    ) => {
      try {
        const keys = await loadUserCaptureKeys();
        if (!keys || cancelled) return;
        const { pushTokens } = await publishNotificationsToAllDevices(keys, prefs);
        if (pushTokens.length === 0 || cancelled) return;
        await fetch("/api/send-push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokens: pushTokens, category }),
        });
      } catch {
        // A failed publish or send must never break the watcher loop.
      }
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
