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
import { publishTodayToAllDevices, classifyToday } from "@/lib/mobile-relay/today-snapshot";
import { publishInventoryToAllDevices } from "@/lib/mobile-relay/inventory-snapshot";
import { publishNotebooksToAllDevices } from "@/lib/mobile-relay/notebooks-snapshot";
import { publishCalculatorsToAllDevices } from "@/lib/mobile-relay/calculators-snapshot";
import {
  buildLibrarySnapshot,
  publishLibrarySnapshot,
} from "@/lib/mobile-relay/library-snapshot";
import { publishMethodToAllDevices } from "@/lib/mobile-relay/method-snapshot";
import {
  buildExperimentNotesSnapshot,
  experimentNotesVersion,
  publishExperimentNotesSnapshot,
} from "@/lib/mobile-relay/experiment-notes-snapshot";
import { fetchAllTasks } from "@/lib/local-api";
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

// The whole-library snapshot is bigger + more expensive to build than the small
// today / inventory snapshots (it reads every method's source protocol), so it
// runs on a SLOWER cadence (every Nth pass) AND only seals + uploads when its
// content hash changed since the last publish. The build itself still runs each
// library pass to compute the hash, but a seal + per-device upload is skipped
// when nothing changed. lastLibraryVersion is module-scoped so it survives the
// effect re-running (folder reconnect / focus churn) within one tab session.
const LIBRARY_PASS_EVERY = 5; // ~ every 5 minutes at the 60s base cadence
let lastLibraryVersion: string | null = null;

// The active-experiment method snapshot runs on the same slow cadence as the
// library publisher (every Nth pass, staggered by 1 so the two heavy passes
// do not overlap in the same minute). Content is hash-gated: a stable focused
// experiment is a cheap no-op because taskId + owner together uniquely identify
// the snapshot content (the snapshot itself is stable when the focused task does
// not change; a changed method attachment will be picked up on the next pass).
// "Focused" = the earliest-starting active experiment that has at least one
// method attachment, breaking ties by lowest task id.
const METHOD_PASS_EVERY = 5; // ~ every 5 minutes, staggered 1 pass after library
// Module-scoped so it survives effect re-runs within one tab session.
let lastMethodKey: string | null = null;
// The focused experiment's lab notes + results (phone-notes P1, read) ride the
// SAME focused-experiment pass as the method snapshot. Content-gated by the
// notes/results markdown hash (NOT just taskId:owner) so an edit to the notes
// republishes while an unchanged experiment is a cheap no-op. Module-scoped so
// it survives effect re-runs within one tab session.
let lastNotesVersion: string | null = null;

export default function TodaySnapshotPublisher() {
  const { currentUser, isConnected } = useFileSystem();

  // Counts publish passes so the heavier library snapshot runs on a slower
  // cadence (every LIBRARY_PASS_EVERY passes) rather than every minute.
  const passCountRef = useRef(0);

  useEffect(() => {
    if (!isConnected || !currentUser) return;

    let cancelled = false;
    // The run-lock and throttle are EFFECT-LOCAL (not component refs) so a
    // torn-down effect can never wedge the next one. In demo the fixture
    // install churns currentUser/isConnected, which re-runs this effect; a
    // component-scoped lock stamped before the async identity load would leave
    // the re-mounted run blocked by the throttle / run-lock and the publisher
    // would never publish. Local state resets cleanly on every remount.
    let running = false;
    let lastRun = 0;

    const runOnce = async () => {
      if (cancelled || running) return;
      const now = Date.now();
      if (now - lastRun < MIN_GAP_MS) return;
      running = true;
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
        // Stamp the throttle only now that we are actually publishing, so a run
        // that bailed early (no identity yet, kill switch off, or torn down
        // mid-load) does not block the next trigger for MIN_GAP_MS.
        lastRun = now;
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
        // Library snapshot: the WHOLE method library so paired phones can browse
        // + read mode every method offline. Runs on a slower cadence (every
        // LIBRARY_PASS_EVERY passes) because it reads every method's source
        // protocol, and only seals + uploads when its content hash changed since
        // the last publish (the build runs to compute the hash, the upload is
        // skipped when unchanged). The hash is deterministic over the projected
        // content, so an unchanged library is a cheap no-op upload.
        if (cancelled) return;
        passCountRef.current += 1;
        if (passCountRef.current % LIBRARY_PASS_EVERY === 1) {
          try {
            const librarySnap = await buildLibrarySnapshot();
            if (cancelled) return;
            if (librarySnap.version !== lastLibraryVersion) {
              const lib = await publishLibrarySnapshot(keys, librarySnap);
              lastLibraryVersion = librarySnap.version;
              if (lib.published > 0 || lib.skipped > 0) {
                console.info(
                  `[library-publisher] published to ${lib.published} device(s), skipped ${lib.skipped} (version ${lib.version.slice(0, 12)})`,
                );
              }
            }
          } catch (err) {
            // Non-fatal: a missed library publish only delays the offline cache
            // refresh to the next slow-cadence pass.
            console.warn("[library-publisher] publish failed (will retry)", err);
          }
        }
        // Active-experiment method snapshot: automatically publish the "focused"
        // experiment's method to paired phones so the companion app's
        // recommendations band populates without requiring a manual button press.
        //
        // Focused = the earliest-starting active experiment (start_date <= today
        // <= end_date, not complete, task_type "experiment") that has at least
        // one method attachment. Ties on start_date broken by lowest task id.
        // Runs on METHOD_PASS_EVERY cadence (staggered 1 pass after library so
        // the two heavy passes do not overlap in the same minute). Content-gated
        // by a "taskId:owner" key so an unchanged focus is a cheap no-op.
        // When no qualifying experiment exists, nothing is published (the phone
        // band correctly hides when the snapshot is absent or empty).
        if (cancelled) return;
        if (passCountRef.current % METHOD_PASS_EVERY === 2) {
          try {
            const today = (() => {
              const now = new Date();
              const y = now.getFullYear();
              const mo = String(now.getMonth() + 1).padStart(2, "0");
              const d = String(now.getDate()).padStart(2, "0");
              return `${y}-${mo}-${d}`;
            })();
            const allTasks = await fetchAllTasks();
            if (!cancelled) {
              const { active } = classifyToday(
                allTasks as unknown as Parameters<typeof classifyToday>[0],
                today,
              );
              // Filter to experiments that have at least one method attachment.
              const candidates = active.filter(
                (t) =>
                  (t as { task_type?: string }).task_type === "experiment" &&
                  Array.isArray((t as { method_attachments?: unknown[] }).method_attachments) &&
                  ((t as { method_attachments?: unknown[] }).method_attachments?.length ?? 0) > 0,
              );
              // Deterministic pick: earliest start_date, then lowest numeric id.
              candidates.sort((a, b) => {
                const dateCmp = a.start_date.localeCompare(b.start_date);
                if (dateCmp !== 0) return dateCmp;
                return Number(a.id) - Number(b.id);
              });
              const focused = candidates[0] as
                | (Parameters<typeof classifyToday>[0][number] & {
                    id: number;
                    owner: string;
                    task_type: string;
                    method_attachments: unknown[];
                  })
                | undefined;
              if (focused) {
                const methodKey = `${focused.id}:${focused.owner}`;
                if (methodKey !== lastMethodKey) {
                  const meth = await publishMethodToAllDevices(
                    keys,
                    focused.id as number,
                    focused.owner as string,
                  );
                  lastMethodKey = methodKey;
                  if (meth.published > 0 || meth.skipped > 0) {
                    console.info(
                      `[method-publisher] published to ${meth.published} device(s), skipped ${meth.skipped} (task ${focused.id})`,
                    );
                  }
                }
                // Experiment notes + results (phone-notes P1, read): publish the
                // focused experiment's notes.md + results.md so the phone hub can
                // render them read-only. Content-gated by the markdown hash so an
                // edit republishes while an unchanged experiment is a no-op.
                try {
                  const notesSnap = await buildExperimentNotesSnapshot(
                    focused.id as number,
                    focused.owner as string,
                  );
                  if (notesSnap && !cancelled) {
                    const notesVersion = experimentNotesVersion(notesSnap);
                    if (notesVersion !== lastNotesVersion) {
                      const notesPub = await publishExperimentNotesSnapshot(
                        keys,
                        notesSnap,
                      );
                      lastNotesVersion = notesVersion;
                      if (notesPub.published > 0 || notesPub.skipped > 0) {
                        console.info(
                          `[experiment-notes-publisher] published to ${notesPub.published} device(s), skipped ${notesPub.skipped} (task ${focused.id})`,
                        );
                      }
                    }
                  }
                } catch (err) {
                  // Non-fatal: a missed notes publish only means the phone hub
                  // shows stale notes until the next slow-cadence pass.
                  console.warn(
                    "[experiment-notes-publisher] publish failed (will retry)",
                    err,
                  );
                }
              }
            }
          } catch (err) {
            // Non-fatal: a missed method publish only means the band stays stale
            // until the next slow-cadence pass.
            console.warn("[method-publisher] publish failed (will retry)", err);
          }
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
        // Mirror the routing config to the relay (phone push P2 + sender-email
        // phase 2.5) so a sender can reach this user while their laptop is closed
        // and the relay can still honor this user's per-category + quiet-hours
        // gate. No research content, only channel toggles + a time window + the
        // tz offset for local time + this user's own notification email.
        if (cancelled) return;
        try {
          await publishNotifyConfig(keys, {
            channels: Object.fromEntries(
              Object.entries(prefs.channels).map(([cat, ch]) => [
                cat,
                { phone: !!ch.phone, email: !!ch.email },
              ]),
            ),
            quietHours: prefs.quietHours,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
            ...(prefs.email ? { email: prefs.email } : {}),
          });
        } catch (err) {
          // Non-fatal: a missed config publish only means P2 falls back to
          // "no buzz" (fail-safe) until the next cadence tick.
          console.warn("[notify-config] publish failed (will retry)", err);
        }
      } catch (err) {
        console.warn("[today-publisher] publish failed (will retry)", err);
      } finally {
        running = false;
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
