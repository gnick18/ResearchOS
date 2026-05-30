// frontend/src/hooks/useMilestoneTwirlTrigger.ts
//
// Milestone twirl BeakerBot trigger (twirl-milestones bot).
//
// Fires the celebratory `twirlMilestone` scene ONCE on the FIRST
// occurrence of each of three rare checkpoint moments, so the twirl
// stays sprinkled and special:
//   1. Finishing the v4 onboarding walkthrough (tour-goodbye outro).
//   2. The user marking their FIRST experiment complete.
//   3. The FIRST time a whole project is fully done (every task in a
//      project complete).
//
// The FOURTH milestone the product team wanted to celebrate (the first
// 7-day usage streak) is deliberately NOT handled here. That milestone
// already drives a corner celebration through CelebrationManager +
// milestone-scheduler, and firing a twirl on top would double-celebrate.
// CelebrationManager instead renders the twirl AS the scene for the
// first-ever `7d` streak milestone (see CelebrationManager). Keeping the
// streak out of this hook is the single-owner guarantee that exactly one
// scene plays for the streak.
//
// Each of the three milestones here is deduped with a per-user
// localStorage flag (mirrors the streak seen-tag + the daily-hello
// per-user lock), so each fires at most once EVER per user. localStorage
// (not session) so a reload never re-fires a milestone the user already
// saw.
//
// Animations opt-out: respected. Before firing, the hook reads the same
// `settings.beakerBotAnimations` preference CelebrationManager checks. A
// user who turned BeakerBot animations off never sees the twirl (the
// localStorage flag is NOT burned in that case, so it can still fire the
// first time the user re-enables animations and hits the milestone.
// Since these are first-occurrence-only moments, a user who has already
// passed the moment simply never sees it, which matches "sprinkled").

import { useEffect } from "react";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";
import { taskCompletionEvents } from "@/lib/tasks/task-completion-events";
import { readUserSettings } from "@/lib/settings/user-settings";
import { TOUR_GOODBYE_PLAY_OUTRO_EVENT } from "@/components/onboarding/v4/steps/cleanup/TourGoodbyeStep";

/** The three milestones this hook owns. The 7-day streak is intentionally
 *  absent (CelebrationManager owns that twirl). */
export type TwirlMilestone =
  | "tourComplete"
  | "firstExperiment"
  | "firstProject";

/** localStorage key holding "1" once `milestone` has fired for `username`.
 *  Per-user so a shared browser celebrates each account's firsts once. */
export function milestoneFlagKey(
  username: string,
  milestone: TwirlMilestone,
): string {
  return `researchOS.twirlMilestone.${username}.${milestone}`;
}

/** True if `milestone` has NOT yet fired for `username`. SSR-safe; on any
 *  storage error returns false (skip) so a broken storage layer can never
 *  spam the twirl on every event. */
export function milestonePending(
  username: string,
  milestone: TwirlMilestone,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(milestoneFlagKey(username, milestone)) !==
      "1";
  } catch {
    return false;
  }
}

/** Record that `milestone` fired for `username`. Best-effort. */
export function markMilestoneFired(
  username: string,
  milestone: TwirlMilestone,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(milestoneFlagKey(username, milestone), "1");
  } catch {
    // Quota / private mode: worst case the milestone could re-fire on a
    // future event, which is a rare flavor easter-egg, not a correctness
    // problem.
  }
}

/**
 * Attempt to fire the twirl for `milestone`. Resolves the per-user dedup
 * flag + the animations opt-out, then fires the scene through the global
 * scene-trigger store. Exported for tests so the fire decision can be
 * exercised without the React event plumbing.
 *
 * Order of operations:
 *   1. Bail if the milestone already fired for this user (dedup).
 *   2. Bail if another scene is already playing (the store would drop
 *      the request anyway; checking first avoids a noisy state update).
 *   3. Bail if the user turned BeakerBot animations off. We do NOT burn
 *      the dedup flag in this case.
 *   4. Burn the dedup flag BEFORE firing so a re-entrant event can't
 *      double-fire, then fire. If the store dropped the request (another
 *      scene won a race), roll the flag back so a later event retries.
 */
export async function fireTwirlMilestone(
  username: string,
  milestone: TwirlMilestone,
): Promise<boolean> {
  if (!username) return false;
  if (!milestonePending(username, milestone)) return false;
  if (useSceneTriggerStore.getState().activeScene !== null) return false;

  // Animations opt-out (same preference CelebrationManager honors). On a
  // read failure treat as enabled (the default) so a transient FS error
  // doesn't silently suppress a once-ever celebration.
  let animationsEnabled = true;
  try {
    const settings = await readUserSettings(username);
    animationsEnabled = settings.beakerBotAnimations;
  } catch {
    animationsEnabled = true;
  }
  if (!animationsEnabled) return false;

  // Re-check dedup after the async settings read: a concurrent event for
  // the same milestone may have fired + burned the flag while we awaited.
  if (!milestonePending(username, milestone)) return false;

  markMilestoneFired(username, milestone);
  const accepted = useSceneTriggerStore
    .getState()
    .fireScene("twirlMilestone", () => {
      // Purely decorative; the store clears activeScene after onComplete.
    });
  if (!accepted) {
    // Another scene won the race after our active-scene check. Roll back
    // so the next qualifying event retries this milestone.
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(milestoneFlagKey(username, milestone));
      } catch {
        // ignore
      }
    }
    return false;
  }
  return true;
}

/**
 * Mounts the milestone twirl trigger. Mount once where the active
 * username is in scope (peer of CelebrationManager in providers.tsx).
 * Pass the active username; when null (no signed-in user) the hook is a
 * no-op.
 *
 * Subscribes to:
 *   - the `tour-goodbye:play-outro` window event (tour completion). The
 *     twirl fires AFTER the goodbye overlay routes home, so it lands as a
 *     fresh beat rather than stacking on the goodbye confetti.
 *   - the task-completion event bus (first experiment + first project).
 */
export function useMilestoneTwirlTrigger(username: string | null): void {
  useEffect(() => {
    if (!username) return;
    if (typeof window === "undefined") return;

    // --- Tour completion ---------------------------------------------
    // The goodbye overlay runs its own ~4.4s cheer/wave/route-home outro.
    // Fire the twirl after that budget so the two celebrations don't
    // overlap; by then the user is on the home surface and the twirl
    // reads as a separate "nice work finishing the tour" flourish.
    const TOUR_OUTRO_BUDGET_MS = 5000;
    let tourTimer: ReturnType<typeof setTimeout> | undefined;
    const onTourGoodbye = () => {
      if (tourTimer !== undefined) return;
      tourTimer = setTimeout(() => {
        tourTimer = undefined;
        void fireTwirlMilestone(username, "tourComplete");
      }, TOUR_OUTRO_BUDGET_MS);
    };
    window.addEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, onTourGoodbye);

    // --- Task completion (first experiment + first project) ----------
    const unsubscribeTasks = taskCompletionEvents.onCompleted((detail) => {
      // Only react to completions performed by THIS signed-in user.
      if (detail.username !== username) return;
      if (detail.taskType === "experiment") {
        void fireTwirlMilestone(username, "firstExperiment");
      }
      if (detail.projectFullyComplete) {
        void fireTwirlMilestone(username, "firstProject");
      }
    });

    return () => {
      window.removeEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, onTourGoodbye);
      if (tourTimer !== undefined) clearTimeout(tourTimer);
      unsubscribeTasks();
    };
  }, [username]);
}

/** Test helper: clears all persisted milestone flags for a user. Not part
 *  of the public API; tests import this directly. */
export function __resetMilestoneTwirlTriggerForTests(username: string): void {
  if (typeof window === "undefined") return;
  for (const m of ["tourComplete", "firstExperiment", "firstProject"] as const) {
    try {
      window.localStorage.removeItem(milestoneFlagKey(username, m));
    } catch {
      // ignore
    }
  }
}
