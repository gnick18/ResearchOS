"use client";

// Mobile DOWNLOAD path, the laptop publisher (piece C).
//
// The mirror image of CaptureInboxPoller. When a folder is connected AND the
// user's identity is unlocked, this seals a small "today" snapshot of the
// folder's tasks to each paired phone and publishes it to the relay (on mount,
// on window focus, and on an interval). The relay only ever holds sealed bytes,
// so each phone can decrypt only its own snapshot. Headless, mounted once in the
// signed-in tree, a no-op when no identity is on hand.
//
// The actual seal + publish logic lives in lib/mobile-relay/today-snapshot.ts
// (publishTodayToAllDevices). See relay/scripts/smoke-snapshot.mjs for the full
// round-trip contract.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef } from "react";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { readUserSettings } from "@/lib/settings/user-settings";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";
import { publishTodayToAllDevices } from "@/lib/mobile-relay/today-snapshot";
import { publishInventoryToAllDevices } from "@/lib/mobile-relay/inventory-snapshot";
import { publishNotebooksToAllDevices } from "@/lib/mobile-relay/notebooks-snapshot";
import { publishCalculatorsToAllDevices } from "@/lib/mobile-relay/calculators-snapshot";
import { publishTimersToAllDevices } from "@/lib/mobile-relay/timers-snapshot";
import { publishNotificationsToAllDevices } from "@/lib/mobile-relay/notifications-snapshot";
import { publishNotifyConfig } from "@/lib/mobile-relay/client";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import { useLaptopTimerStore } from "@/lib/timers/laptop-timers";

const PUBLISH_INTERVAL_MS = 60_000;
// Throttle so a focus event landing on top of the interval (or vice versa) does
// not double-publish within this window.
const MIN_GAP_MS = 30_000;

export default function TodaySnapshotPublisher() {
  const { currentUser, isConnected } = useFileSystem();

  // A run-lock so overlapping triggers (interval + focus) don't double-publish.
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  useEffect(() => {
    if (!isConnected || !currentUser) return;

    let cancelled = false;

    const runOnce = async () => {
      if (cancelled || runningRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < MIN_GAP_MS) return;
      runningRef.current = true;
      lastRunRef.current = now;
      try {
        const keys = await loadUserCaptureKeys();
        // No unlocked identity on hand here (needs-restore state): stay dark.
        if (!keys || cancelled) return;
        // Kill switch (hub Settings -> "Auto-publish snapshots to paired
        // phones"). Off stops the laptop from pushing today/inventory/notebook
        // snapshots; read each run so a flip takes effect by the next tick.
        // Focus context (the live routing channel) stays up so capture routing
        // still resolves; this gate is the data snapshots only.
        const settings = await readUserSettings(currentUser);
        if (cancelled || !settings.autoPublishSnapshotsToPhones) return;
        const { published, skipped } = await publishTodayToAllDevices(keys);
        if (published > 0 || skipped > 0) {
          console.info(
            `[today-publisher] published to ${published} device(s), skipped ${skipped}`,
          );
        }
        // Same cadence as the today snapshot: seal + publish the inventory
        // snapshot so paired phones can resolve a scanned barcode offline.
        if (cancelled) return;
        const inv = await publishInventoryToAllDevices(keys);
        if (inv.published > 0 || inv.skipped > 0) {
          console.info(
            `[inventory-publisher] published to ${inv.published} device(s), skipped ${inv.skipped}`,
          );
        }
        // Notebooks snapshot: the list of notebooks the user can file into,
        // used by the NotebookChooser on the phone (chooser bot, 2026-06-09).
        if (cancelled) return;
        const nb = await publishNotebooksToAllDevices(keys);
        if (nb.published > 0 || nb.skipped > 0) {
          console.info(
            `[notebooks-publisher] published to ${nb.published} device(s), skipped ${nb.skipped}`,
          );
        }
        // Calculators snapshot: the user's own custom calculators plus the
        // lab-shared ones they can see, so a calculator built on the laptop runs
        // at the bench. A no-op until the builder ships (CALC_BUILDER_ENABLED).
        if (cancelled) return;
        const calc = await publishCalculatorsToAllDevices(keys);
        if (calc.published > 0 || calc.skipped > 0) {
          console.info(
            `[calculators-publisher] published to ${calc.published} device(s), skipped ${calc.skipped}`,
          );
        }
        // Timers snapshot: the laptop's own running timers so they mirror onto
        // the phone. Also published on change (the effect below) for near-instant
        // propagation; this periodic pass is the fallback + re-seal for late
        // device pairings.
        if (cancelled) return;
        await publishTimersToAllDevices(keys);
        // Notifications snapshot (phase 3, the phone channel): seal the user's
        // phone-routed notifications so the companion app can list them at the
        // bench. The per-category phone toggle does the filtering inside the
        // builder; this is a synced list, not an OS push.
        if (cancelled) return;
        const prefs = normalizeNotificationPreferences(
          settings.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
        );
        const notif = await publishNotificationsToAllDevices(keys, prefs);
        if (notif.published > 0 || notif.skipped > 0) {
          console.info(
            `[notifications-publisher] published to ${notif.published} device(s), skipped ${notif.skipped}`,
          );
        }
        // Mirror the routing config to the relay (phone push P2) so a sender can
        // buzz this user while their laptop is closed and the relay can still
        // honor this user's per-category + quiet-hours gate. No research content,
        // only channel toggles + a time window + the tz offset for local time.
        if (cancelled) return;
        try {
          await publishNotifyConfig(keys, {
            channels: Object.fromEntries(
              Object.entries(prefs.channels).map(([cat, ch]) => [
                cat,
                { phone: !!ch.phone },
              ]),
            ),
            quietHours: prefs.quietHours,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
          });
        } catch (err) {
          // Non-fatal: a missed config publish only means P2 falls back to
          // "no buzz" (fail-safe) until the next cadence tick.
          console.warn("[notify-config] publish failed (will retry)", err);
        }
      } catch (err) {
        console.warn("[today-publisher] publish failed (will retry)", err);
      } finally {
        runningRef.current = false;
      }
    };

    void runOnce();
    const timer = setInterval(() => void runOnce(), PUBLISH_INTERVAL_MS);

    const onFocus = () => void runOnce();
    const onVisible = () => {
      if (document.visibilityState === "visible") void runOnce();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [currentUser, isConnected]);

  // Event-driven timers publish. A timer started or cancelled on the laptop
  // should reach the phone in a second or two, not wait for the 60s snapshot
  // cadence. Subscribe to the laptop timer store and publish on change, keyed by
  // the running-timer id set so the per-second `now` ticks do NOT trigger a
  // publish. Debounced + kill-switch gated, same as the periodic pass.
  useEffect(() => {
    if (!isConnected || !currentUser) return;

    let lastSig = "";
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const publishTimers = async () => {
      try {
        const keys = await loadUserCaptureKeys();
        if (!keys) return;
        const settings = await readUserSettings(currentUser);
        if (!settings.autoPublishSnapshotsToPhones) return;
        await publishTimersToAllDevices(keys);
      } catch (err) {
        console.warn("[timers-publisher] change publish failed", err);
      }
    };

    const signature = (
      timers: ReturnType<typeof useLaptopTimerStore.getState>["timers"],
    ) =>
      timers
        .filter((t) => t.origin === "laptop" && t.status === "running")
        .map((t) => t.id)
        .sort()
        .join(",");

    lastSig = signature(useLaptopTimerStore.getState().timers);

    const unsub = useLaptopTimerStore.subscribe((state) => {
      const sig = signature(state.timers);
      if (sig === lastSig) return;
      lastSig = sig;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void publishTimers(), 400);
    });

    return () => {
      unsub();
      if (debounce) clearTimeout(debounce);
    };
  }, [currentUser, isConnected]);

  return null;
}
