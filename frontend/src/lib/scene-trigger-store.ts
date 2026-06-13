import { create } from "zustand";

/**
 * Scene-trigger store: a tiny event bus that lets any component fire a
 * named easter-egg scene (BugStomp, etc.) and run a callback once the
 * scene's intro/outro animation completes.
 *
 * Why a Zustand store rather than a context: the trigger is fire-and-
 * forget — callsites (FeedbackButton click handler, useErrorReporting
 * effect) don't want to manage scene-active state themselves, and we
 * want a single global instance even when the trigger is invoked from
 * deeply-nested children. `useAppStore` already exists for this kind
 * of cross-tree signalling; a dedicated store keeps the surface tiny
 * and avoids piling unrelated concerns onto the main app store.
 *
 * The single SceneTriggerHost mounted in AppShell subscribes to
 * `activeScene` + `activeOnComplete`, renders the matching scene with
 * `active={true}`, and calls `clearActiveScene()` from the scene's
 * `onComplete` (which also invokes the caller's stored callback). If
 * a second fireScene call arrives while a scene is already playing,
 * it's silently dropped — playback is non-overlapping by design (the
 * bug splat is a "yes, we received this" gesture; doubling it on a
 * burst of errors would be loud, not satisfying).
 */

/** Supported scene IDs. Keep this list tight, the host has a hard
 *  switch for each entry. Adding a new scene means adding both a
 *  literal here and a case in `SceneTriggerHost`.
 *
 *  - `bugstomp`: bug-report path (manual click + auto-error).
 *  - `twirlMilestone`: the celebratory BeakerBot twirl, fired ONCE on the
 *    first occurrence of each rare checkpoint moment (tour complete,
 *    first experiment complete, first project fully done). The 7-day
 *    streak twirl is NOT routed here: it is owned by CelebrationManager
 *    so it never double-fires on top of the corner streak celebration.
 *    See `useMilestoneTwirlTrigger`. */
export type SceneTriggerId = "bugstomp" | "twirlMilestone";

interface SceneTriggerState {
  /** Currently-playing scene, or null when idle. */
  activeScene: SceneTriggerId | null;
  /** Callback to run after the active scene's onComplete fires. The
   *  host invokes this BEFORE clearing activeScene so consumers see
   *  the scene mid-teardown rather than a quick flicker through null. */
  activeOnComplete: (() => void) | null;
  /** Timestamp (ms since epoch) of the last fireScene attempt, used to
   *  enforce the cooldown for the auto-error path. Stored as state
   *  rather than a module-level let so tests can clear it via the
   *  store's setState API. */
  lastFireAt: number;

  /**
   * Request a scene to play. Returns true if accepted, false if dropped
   * (because another scene is already playing OR the optional cooldown
   * window has not elapsed since the last accepted fire).
   *
   * The `cooldownMs` argument lets the auto-error path enforce a
   * minimum gap between splats so a burst of errors doesn't trigger
   * a chain of scenes. Manual triggers (the user clicked Report Bug)
   * pass 0 / omit it — the user explicitly asked for the scene.
   */
  fireScene: (
    sceneId: SceneTriggerId,
    onComplete: () => void,
    cooldownMs?: number,
  ) => boolean;

  /** Host-only: clears the active scene after onComplete has been
   *  invoked. Not intended to be called from outside SceneTriggerHost. */
  clearActiveScene: () => void;

  /** Test helper: reset the store to its initial state. Not part of
   *  the public API — tests import this directly. */
  __reset: () => void;
}

export const useSceneTriggerStore = create<SceneTriggerState>((set, get) => ({
  activeScene: null,
  activeOnComplete: null,
  lastFireAt: 0,

  fireScene: (sceneId, onComplete, cooldownMs = 0) => {
    const { activeScene, lastFireAt } = get();
    if (activeScene !== null) {
      // A scene is already playing — drop the new request. The caller's
      // onComplete is never invoked in this branch; if the callsite
      // cares (e.g. the manual Report Bug button) it should pre-check
      // `activeScene` or rely on the boolean return.
      return false;
    }
    if (cooldownMs > 0 && Date.now() - lastFireAt < cooldownMs) {
      return false;
    }
    set({
      activeScene: sceneId,
      activeOnComplete: onComplete,
      lastFireAt: Date.now(),
    });
    return true;
  },

  clearActiveScene: () => {
    set({ activeScene: null, activeOnComplete: null });
  },

  __reset: () => {
    set({ activeScene: null, activeOnComplete: null, lastFireAt: 0 });
  },
}));

/**
 * Convenience hook for callsites. Returns just the fire function so
 * components don't subscribe to the full store and re-render on every
 * scene state change (which would cause every FeedbackButton in the
 * tree to re-render mid-scene — harmless but noisy).
 */
export function useSceneTrigger() {
  const fireScene = useSceneTriggerStore((s) => s.fireScene);
  return { fireScene };
}
