"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { eventsApi, sharingApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readPrefs, type NotificationPrefs } from "./notification-prefs-store";
import { useExternalEvents } from "./use-external-events";
import type { Event, ExternalEvent } from "@/lib/types";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { publishReminderSchedule } from "@/lib/mobile-relay/client";
import { readUserSettings } from "@/lib/settings/user-settings";

/**
 * Schedule and fire calendar event reminders.
 *
 * Strategy: while a ResearchOS tab is open, walk the user's events for the
 * next 24h and queue a `setTimeout` for each one whose reminder time hasn't
 * yet passed. When a timer fires, append an entry to the user's
 * `_notifications.json` (so the existing bell badge increments) and — if
 * the user has granted `Notification.permission` — also raise an OS-level
 * popup. Track fired reminders in `localStorage` keyed by
 * `<event_id>:<offset_minutes>` so a page reload doesn't refire history.
 *
 * All-day events are intentionally skipped — there's no obvious "X minutes
 * before" for events with no start time.
 */

const HORIZON_MS = 24 * 60 * 60 * 1000;
const LS_PREFIX = "ros-reminder-fired:";

function eventStartMs(dateStr: string, timeStr: string | null): number | null {
  if (!timeStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  if ([y, m, d, h, min].some((n) => Number.isNaN(n))) return null;
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

function firedKey(eventId: string, offset: number): string {
  return `${LS_PREFIX}${eventId}:${offset}`;
}

function markFired(eventId: string, offset: number) {
  try {
    localStorage.setItem(firedKey(eventId, offset), Date.now().toString());
  } catch {
    /* private mode / storage full — non-fatal */
  }
}

function isFired(eventId: string, offset: number): boolean {
  try {
    return localStorage.getItem(firedKey(eventId, offset)) !== null;
  } catch {
    return false;
  }
}

/** Sweep stale localStorage keys older than 7 days. Keeps it from growing
 *  unbounded over time. */
function gcFiredKeys() {
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LS_PREFIX)) continue;
      const stamp = parseInt(localStorage.getItem(key) ?? "0", 10);
      if (stamp < cutoff) toDelete.push(key);
    }
    for (const key of toDelete) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function osNotify(title: string, body: string, tag: string, onClick: () => void) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag, icon: "/favicon.ico" });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* some browsers throw under specific conditions; non-fatal */
  }
}

interface FireableReminder {
  fireAt: number;
  eventId: string;
  eventKind: "native" | "external";
  eventTitle: string;
  eventStartIso: string;
  eventDate: string;
  eventLocation: string | null;
  offsetMinutes: number;
}

function collectReminders(
  events: Event[],
  externalEvents: ExternalEvent[],
  prefs: NotificationPrefs,
  now: number
): FireableReminder[] {
  const out: FireableReminder[] = [];
  const offsetMs = prefs.offsetMinutes * 60 * 1000;

  const pushFor = (
    eventId: string,
    eventKind: "native" | "external",
    e: { title: string; start_date: string; start_time: string | null; location: string | null }
  ) => {
    const startMs = eventStartMs(e.start_date, e.start_time);
    if (startMs === null) return;
    const fireAt = startMs - offsetMs;
    if (fireAt <= now) return;
    if (fireAt > now + HORIZON_MS) return;
    if (isFired(eventId, prefs.offsetMinutes)) return;
    out.push({
      fireAt,
      eventId,
      eventKind,
      eventTitle: e.title,
      eventStartIso: new Date(startMs).toISOString(),
      eventDate: e.start_date,
      eventLocation: e.location,
      offsetMinutes: prefs.offsetMinutes,
    });
  };

  for (const e of events) {
    pushFor(`native:${e.id}`, "native", {
      title: e.title,
      start_date: e.start_date,
      start_time: e.start_time,
      location: e.location,
    });
  }
  for (const e of externalEvents) {
    pushFor(`external:${e.id}`, "external", {
      title: e.title,
      start_date: e.start_date,
      start_time: e.start_time,
      location: e.location,
    });
  }
  return out;
}

export function useEventReminders() {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const timersRef = useRef<number[]>([]);

  const { data: prefs } = useQuery({
    queryKey: ["notification-prefs", currentUser],
    queryFn: async () => (currentUser ? readPrefs(currentUser) : null),
    enabled: !!currentUser,
    staleTime: 5 * 60 * 1000,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["events", currentUser],
    queryFn: eventsApi.list,
    enabled: !!currentUser,
  });

  const { events: externalEvents } = useExternalEvents();

  useEffect(() => {
    // Clear any previously scheduled timers.
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];

    if (!currentUser || !prefs?.enabled) return;

    gcFiredKeys();

    const now = Date.now();
    const fireables = collectReminders(events, externalEvents, prefs, now);

    // Phone push P3b: mirror the upcoming reminder schedule (content-free, just
    // opaque ids + fire times) to the relay so it can buzz the phone for the ones
    // that come due while the laptop is closed. REPLACE each pass. Gated by the
    // same autoPublishSnapshotsToPhones kill switch as the snapshot publisher; off
    // publishes an empty schedule to clear any prior. Fire-and-forget + account
    // only (no keys -> no-op). The relay's dead-man's-switch keeps it from
    // double-buzzing while this tab is open (it fires the reminder locally below).
    void (async () => {
      try {
        const keys = await loadUserCaptureKeys();
        if (!keys) return;
        const settings = await readUserSettings(currentUser);
        const schedule = settings.autoPublishSnapshotsToPhones
          ? fireables.map((r) => ({ id: r.eventId, fireAt: r.fireAt }))
          : [];
        await publishReminderSchedule(keys, schedule);
      } catch {
        // Best-effort; a missed registration only delays an offline reminder buzz.
      }
    })();

    for (const r of fireables) {
      const delay = Math.max(0, r.fireAt - now);
      const timerId = window.setTimeout(async () => {
        // Re-check fired flag in case another tab beat us to it.
        if (isFired(r.eventId, r.offsetMinutes)) return;
        markFired(r.eventId, r.offsetMinutes);
        try {
          await sharingApi.createEventReminder({
            event_id: r.eventId,
            event_kind: r.eventKind,
            event_title: r.eventTitle,
            event_start_iso: r.eventStartIso,
            event_date: r.eventDate,
            event_location: r.eventLocation,
            offset_minutes: r.offsetMinutes,
          });
          // Bump the bell badge immediately (NotificationBadge listens for this).
          window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
          queryClient.invalidateQueries({ queryKey: ["notifications", currentUser] });
        } catch (err) {
          console.error("[reminder] failed to persist", err);
        }
        const bodyParts = [
          new Date(r.eventStartIso).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          }),
        ];
        if (r.eventLocation) bodyParts.push(r.eventLocation);
        osNotify(
          `${r.eventTitle} in ${r.offsetMinutes} min`,
          bodyParts.join(" · "),
          `ros-event:${r.eventId}:${r.offsetMinutes}`,
          () => {
            // Best effort focus only — the AppShell will already be on screen.
          }
        );
      }, delay);
      timersRef.current.push(timerId);
    }

    return () => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
    };
  }, [currentUser, prefs, events, externalEvents, queryClient]);
}
