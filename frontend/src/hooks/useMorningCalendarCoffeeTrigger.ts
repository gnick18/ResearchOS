// frontend/src/hooks/useMorningCalendarCoffeeTrigger.ts
//
// Morning-calendar coffee BeakerBot trigger.
//
// Fires the `coffeeMorningCalendar` scene the FIRST time the Calendar
// page is opened on a given local day, when local time is before 8am.
// "First time today" is tracked in sessionStorage by YYYY-MM-DD, so a
// page refresh inside the same morning doesn't double-fire, while a
// fresh morning (next calendar day) will fire again.
//
// Gates (all must hold):
//   - local hour is strictly less than MORNING_CUTOFF_HOUR (8).
//   - today's YYYY-MM-DD has not already been fired during this browser
//     session.
//   - the tab is visible.
//   - no scene is currently active.
//
// Like the late-night trigger, there is no global "animations disabled"
// preference today. When one lands, gate it here too.

import { useEffect } from "react";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";

/** Local hour cutoff; the trigger fires only when getHours() < this. */
export const MORNING_CUTOFF_HOUR = 8;

/** sessionStorage key storing the YYYY-MM-DD of the last morning fire.
 *  When the stored date matches today's date, the trigger does not
 *  re-fire. */
export const MORNING_STORAGE_KEY =
  "researchOS.scene.coffeeMorningCalendar.firedDate";

/** Format a Date as YYYY-MM-DD using LOCAL time (matches `getHours()`
 *  semantics throughout the file). Exported for tests. */
export function formatLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Pure decision helper, exported for tests. Returns the date key to
 *  persist when the trigger should fire, or null otherwise. */
export function decideMorningCalendarFire({
  now,
  visibilityState,
  storedDateKey,
  sceneActive,
}: {
  now: Date;
  visibilityState: DocumentVisibilityState;
  /** Last stored YYYY-MM-DD, or null if nothing persisted yet. */
  storedDateKey: string | null;
  sceneActive: boolean;
}): string | null {
  if (visibilityState !== "visible") return null;
  if (sceneActive) return null;
  if (now.getHours() >= MORNING_CUTOFF_HOUR) return null;
  const todayKey = formatLocalDateKey(now);
  if (storedDateKey === todayKey) return null;
  return todayKey;
}

/**
 * Mounts the morning-calendar coffee trigger. Mount once on the
 * Calendar page (top of `CalendarPage` body, before any conditional
 * returns) so it fires on calendar open specifically, not on every
 * route.
 */
export function useMorningCalendarCoffeeTrigger(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const visibilityState =
      typeof document === "undefined"
        ? ("visible" as DocumentVisibilityState)
        : document.visibilityState;

    const tryFire = () => {
      const sceneActive =
        useSceneTriggerStore.getState().activeScene !== null;
      const storedDateKey =
        typeof sessionStorage === "undefined"
          ? null
          : sessionStorage.getItem(MORNING_STORAGE_KEY);
      const todayKey = decideMorningCalendarFire({
        now: new Date(),
        visibilityState:
          typeof document === "undefined"
            ? ("visible" as DocumentVisibilityState)
            : document.visibilityState,
        storedDateKey,
        sceneActive,
      });
      if (todayKey === null) return;

      // Record BEFORE firing so a re-entry can't double-fire.
      try {
        sessionStorage.setItem(MORNING_STORAGE_KEY, todayKey);
      } catch {
        // Non-fatal: worst case the trigger fires twice if storage is full.
      }

      const accepted = useSceneTriggerStore
        .getState()
        .fireScene("coffeeMorningCalendar", () => {
          // No follow-up; decorative only.
        });
      if (!accepted) {
        // Another scene won the race. Roll back so we retry on next mount.
        try {
          sessionStorage.removeItem(MORNING_STORAGE_KEY);
        } catch {
          // ignore
        }
      }
    };

    // Fire-on-mount only: this hook runs from CalendarPage, so "page
    // mount" already means "user opened Calendar". No interval needed.
    // Visibility check is still useful — if the user navigates to
    // Calendar via a back-tab while the tab was hidden, wait for
    // visibility before firing.
    if (visibilityState === "visible") {
      tryFire();
    } else {
      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          tryFire();
          document.removeEventListener("visibilitychange", onVisibility);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }
  }, []);
}

/** Test helper: clears the persisted "fired date" value. Not part of
 *  the public API; tests import this directly. */
export function __resetMorningCalendarCoffeeTriggerForTests(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(MORNING_STORAGE_KEY);
}
