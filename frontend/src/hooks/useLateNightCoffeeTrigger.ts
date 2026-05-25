// frontend/src/hooks/useLateNightCoffeeTrigger.ts
//
// Late-night coffee BeakerBot trigger.
//
// Fires the `coffeeLateNight` scene at most once per crossed local hour
// while the local time is in the late-night window [23, 00, 01, 02].
// Concretely: visiting the app at 23:14, then again at 00:08 fires
// twice (once for hour 23, once for hour 0). A page refresh inside the
// same hour does not double-fire because the "hours already fired" set
// is mirrored to sessionStorage.
//
// Gates (all must hold):
//   - local hour is in LATE_NIGHT_HOURS.
//   - the hour has not already been fired during this browser session.
//   - the tab is visible (document.visibilityState === "visible") so the
//     scene does not play behind a backgrounded tab.
//   - no scene is currently active (the store's fireScene drops the
//     request anyway, but checking first avoids a noisy state update).
//
// There is no global "animations disabled" preference in the codebase
// today (only the per-scene `prefers-reduced-motion` check inside the
// scene component itself). When such a preference lands, gate it here
// too. (Tracked as TODO at the call site.)

import { useEffect } from "react";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";

/** Local hours that count as "late night" for the coffee trigger. */
export const LATE_NIGHT_HOURS: readonly number[] = [23, 0, 1, 2];

/** Poll interval, ms. A whole minute is plenty: the trigger has a
 *  per-hour granularity and the visit-time check on mount handles the
 *  arrival-at-night case immediately. */
export const LATE_NIGHT_POLL_MS = 60_000;

/** sessionStorage key holding the JSON-stringified array of hours that
 *  have already fired during this browser session. Survives a refresh
 *  inside the same tab; cleared when the tab closes (sessionStorage
 *  scope). */
export const LATE_NIGHT_STORAGE_KEY =
  "researchOS.scene.coffeeLateNight.hoursFired";

/** Read the set of already-fired hours from sessionStorage. Returns an
 *  empty Set on parse failure / SSR / older serialized shapes. */
function readFiredHours(): Set<number> {
  if (typeof sessionStorage === "undefined") return new Set();
  const raw = sessionStorage.getItem(LATE_NIGHT_STORAGE_KEY);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((h): h is number => typeof h === "number"));
    }
  } catch {
    // fall through
  }
  return new Set();
}

/** Persist the set of already-fired hours to sessionStorage. */
function writeFiredHours(hours: Set<number>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      LATE_NIGHT_STORAGE_KEY,
      JSON.stringify(Array.from(hours)),
    );
  } catch {
    // Quota errors are non-fatal: worst case we re-fire next refresh.
  }
}

/** Pure decision helper, exported for tests so the trigger logic can be
 *  exercised without spinning up React + timers + the global store.
 *
 *  Returns the hour to fire (and persist) when all gates pass, or null
 *  when the trigger should not fire right now. */
export function decideLateNightFire({
  now,
  visibilityState,
  firedHours,
  sceneActive,
}: {
  /** Current Date (caller may freeze for tests). */
  now: Date;
  /** document.visibilityState value, "visible" required. */
  visibilityState: DocumentVisibilityState;
  /** Set of hours already fired during this session. */
  firedHours: ReadonlySet<number>;
  /** Whether any scene is currently playing. */
  sceneActive: boolean;
}): number | null {
  if (visibilityState !== "visible") return null;
  if (sceneActive) return null;
  const hour = now.getHours();
  if (!LATE_NIGHT_HOURS.includes(hour)) return null;
  if (firedHours.has(hour)) return null;
  return hour;
}

/**
 * Mounts the late-night coffee trigger. Mount once at the AppShell
 * level, after login (so the trigger doesn't fire on the login screen
 * where no work is happening).
 *
 * The hook is a pure side-effect; it returns nothing.
 */
export function useLateNightCoffeeTrigger(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const tryFire = () => {
      const visibilityState =
        typeof document === "undefined"
          ? ("visible" as DocumentVisibilityState)
          : document.visibilityState;
      const sceneActive =
        useSceneTriggerStore.getState().activeScene !== null;
      const firedHours = readFiredHours();
      const fire = decideLateNightFire({
        now: new Date(),
        visibilityState,
        firedHours,
        sceneActive,
      });
      if (fire === null) return;

      // Record BEFORE firing so a synchronous re-entry (poll + visibility
      // event landing in the same microtask) can't double-fire.
      firedHours.add(fire);
      writeFiredHours(firedHours);

      const accepted = useSceneTriggerStore
        .getState()
        .fireScene("coffeeLateNight", () => {
          // No follow-up modal; the scene is purely decorative. The store
          // clears activeScene after onComplete.
        });
      if (!accepted) {
        // Another scene was already playing (rare; we checked above but
        // a manual bugstomp could land in the same tick). Roll back the
        // persisted hour so the next poll retries.
        firedHours.delete(fire);
        writeFiredHours(firedHours);
      }
    };

    // Fire-on-mount: covers the "visit at 23:30" case immediately.
    tryFire();

    // 60s poll: covers hour boundaries crossed while the tab stays open
    // (e.g. user keeps the app open from 22:55 → 00:05 — the 23:00 hour
    // mark fires within ~60s, the 00:00 hour mark fires within ~60s).
    const intervalId = window.setInterval(tryFire, LATE_NIGHT_POLL_MS);

    // Re-check on visibility change so tabbing back into a backgrounded
    // tab doesn't have to wait up to a full poll cycle.
    const onVisibility = () => tryFire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

/** Test helper: clears the persisted "fired hours" set. Not part of the
 *  public API; tests import this directly. */
export function __resetLateNightCoffeeTriggerForTests(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(LATE_NIGHT_STORAGE_KEY);
}
