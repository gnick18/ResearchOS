"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BeakerBotBlowingBubblesScene from "@/components/BeakerBotBlowingBubblesScene";
import BeakerBotTooManyBeakersScene from "@/components/BeakerBotTooManyBeakersScene";

/**
 * IdleAnimationManager.
 *
 * Mounts a watcher for user inactivity. After IDLE_THRESHOLD_MS of no
 * input on `window`, picks a random scene from IDLE_POOL and renders
 * it once. After the scene calls onComplete (or after a hard timeout
 * fallback) it unmounts the scene and locks out further plays for the
 * rest of the session.
 *
 * Mounted in `lib/providers.tsx` next to CelebrationManager so they
 * share the same lifecycle (signed-in user, inside V4MountForUser).
 *
 * Separate from CelebrationManager by design:
 *   - CelebrationManager is event-driven (streak milestones, account
 *     anniversaries). Each fire is tied to a persisted "seen" tag.
 *   - IdleAnimationManager is timer-driven (the user wandered away).
 *     A fire is purely flavor; nothing persists across reloads beyond
 *     the per-session lock in sessionStorage.
 *
 * Gating rules (Grant brief, 2026-05-25):
 *   1. Fires AT MOST ONCE per session (sessionStorage lock).
 *   2. Only fires while document.visibilityState === "visible". A tab
 *      backgrounded the entire time should NOT pop a scene the moment
 *      it returns to foreground — the timer resets on visibilitychange.
 *   3. Active modals/popups: no central registry exists today, so this
 *      is a TODO. Until a popup-stack signal lands the manager only
 *      gates on visibility. Documented at the gating block below.
 *   4. Animation-disabled preference: no project-wide flag exists today
 *      (TODO). The scenes themselves honor prefers-reduced-motion via
 *      their own matchMedia gate, so an OS-level reduce-motion user
 *      still gets a graceful 2s static fallback rather than the full
 *      slapstick / bubble stream.
 */

// --------------------------------------------------------------------
// Tuning constants — adjust here if Grant wants longer/shorter idle
// --------------------------------------------------------------------

/** How long the user must be idle before a scene can fire. Tune by
 *  editing this constant. Default 4 minutes — long enough for the
 *  user to look away from the screen for a research read or step
 *  away from the bench briefly without getting jump-scared by a
 *  surprise animation. */
export const IDLE_THRESHOLD_MS = 4 * 60 * 1000;

/** How often we coalesce input events. Throttling keeps mousemove
 *  spam from re-arming the timer thousands of times per second. We
 *  just need a coarse "user did something recently" signal; 250ms
 *  is plenty fine-grained for a 4-minute threshold. */
const INPUT_THROTTLE_MS = 250;

/** Hard cap on how long a scene is allowed to occupy the screen.
 *  Each scene fires its own onComplete when its sequence ends, but
 *  if something wedges (timer cleared mid-sequence, etc.) we still
 *  want to unmount and free the corner. 12s comfortably covers the
 *  longest scene in the pool (BlowingBubbles, ~8s) plus headroom. */
const SCENE_HARD_TIMEOUT_MS = 12000;

/** sessionStorage key — persists across hot-reloads within a tab,
 *  resets when the tab closes. Matches the project's
 *  `researchOS.*` key namespace convention. */
export const IDLE_FIRED_SESSION_KEY = "researchOS.idleAnimation.firedThisSession";

/** Input events that should reset the inactivity timer. Throttled
 *  via a single shared handler. `scroll` is listened to on window
 *  with capture=true so child scroll containers count too. */
const INPUT_EVENTS = ["mousemove", "keydown", "scroll", "click"] as const;

// --------------------------------------------------------------------
// Idle pool
// --------------------------------------------------------------------

/** A single entry in the idle-animation pool. `render` receives a
 *  one-shot dismiss callback that the manager wires to the scene's
 *  onComplete. Adding a new scene means appending one more entry. */
export interface IdleAnimationPoolEntry {
  id: string;
  render: (onComplete: () => void) => React.ReactElement;
}

export const IDLE_POOL: ReadonlyArray<IdleAnimationPoolEntry> = [
  {
    id: "idle-bubbles",
    render: (onComplete) => (
      <BeakerBotBlowingBubblesScene active onComplete={onComplete} />
    ),
  },
  {
    id: "idle-tooManyBeakers",
    render: (onComplete) => (
      <BeakerBotTooManyBeakersScene active onComplete={onComplete} />
    ),
  },
];

/** Pick a random entry from the pool. Pulled out + exported so tests
 *  can spy on Math.random and assert deterministic selection. */
export function pickRandomIdleAnimation(
  pool: ReadonlyArray<IdleAnimationPoolEntry> = IDLE_POOL,
): IdleAnimationPoolEntry {
  if (pool.length === 0) {
    // Defensive: pool is non-empty at module level. Fall back to the
    // first entry's shape so callers still get something renderable.
    throw new Error("[IdleAnimationManager] IDLE_POOL is empty");
  }
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? pool[0]!;
}

// --------------------------------------------------------------------
// sessionStorage helpers (SSR-safe + try/catch for incognito quotas)
// --------------------------------------------------------------------

function readFiredLock(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(IDLE_FIRED_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFiredLock(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(IDLE_FIRED_SESSION_KEY, "1");
  } catch {
    // Quota exceeded / private mode. The in-memory `firedThisSession`
    // ref still blocks repeat fires for the lifetime of this mount.
  }
}

// --------------------------------------------------------------------
// Component
// --------------------------------------------------------------------

export default function IdleAnimationManager() {
  const [active, setActive] = useState<IdleAnimationPoolEntry | null>(null);

  // In-memory mirror of the sessionStorage lock. Initialized from
  // storage so a hot-reload within the same tab keeps the lock honest.
  const firedThisSessionRef = useRef<boolean>(readFiredLock());

  // Mutable handles for the idle timer + last-input timestamp. Held
  // in refs so the throttle handler can read + update without
  // re-running the effect that wires the listeners. Initialized to 0
  // so the ref factory stays pure; the effect below sets the real
  // wall-clock baseline on mount.
  const idleTimerRef = useRef<number | null>(null);
  const lastInputAtRef = useRef<number>(0);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  /** Attempt to fire a scene. Bails out under any gating rule so the
   *  call site can wire this to the idle timer without re-checking. */
  const tryFire = useCallback(() => {
    if (firedThisSessionRef.current) return;
    if (active !== null) return;
    if (typeof document === "undefined") return;
    // Visibility gate: don't pop a scene in a background tab. The
    // visibilitychange listener (below) re-arms the timer on the
    // next visibility-visible event so the user has to be both
    // present AND idle for the threshold.
    if (document.visibilityState !== "visible") return;

    const pick = pickRandomIdleAnimation();
    firedThisSessionRef.current = true;
    writeFiredLock();
    setActive(pick);
  }, [active]);

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    if (firedThisSessionRef.current) return;
    idleTimerRef.current = window.setTimeout(() => {
      tryFire();
    }, IDLE_THRESHOLD_MS);
  }, [clearIdleTimer, tryFire]);

  // ----- Input listeners + visibility gate -----------------------
  //
  // One throttled handler shared across all input event types.
  // Records the most-recent input timestamp + resets the idle timer.
  // The throttle is wall-clock-based (not setTimeout-based) so a
  // burst of mousemoves only schedules one timer reset per
  // INPUT_THROTTLE_MS window — keeping CPU + setTimeout churn low.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (firedThisSessionRef.current) return;

    let lastHandledAt = 0;

    const onInput = () => {
      const now = Date.now();
      if (now - lastHandledAt < INPUT_THROTTLE_MS) return;
      lastHandledAt = now;
      lastInputAtRef.current = now;
      // Re-arm the timer. Cheap because clearTimeout +
      // setTimeout are essentially free.
      armIdleTimer();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // User came back to the tab. Re-arm so we don't immediately
        // fire just because the timer expired while the tab was
        // backgrounded (that's not "user idle in the app" — that's
        // "user was using another app").
        lastInputAtRef.current = Date.now();
        armIdleTimer();
      } else {
        // Tab backgrounded. Pause the timer so it doesn't tick down
        // while the app isn't visible.
        clearIdleTimer();
      }
    };

    for (const ev of INPUT_EVENTS) {
      // capture=true so scroll events inside scroll containers
      // bubble up to our window-level listener.
      window.addEventListener(ev, onInput, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Seed the last-input baseline + arm the initial timer on mount.
    lastInputAtRef.current = Date.now();
    armIdleTimer();

    return () => {
      for (const ev of INPUT_EVENTS) {
        window.removeEventListener(ev, onInput, { capture: true } as EventListenerOptions);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      clearIdleTimer();
    };
  }, [armIdleTimer, clearIdleTimer]);

  // ----- Scene completion: clear active + hard-timeout safety net -
  //
  // The scene fires onComplete when its own sequence ends. We also
  // schedule a belt-and-suspenders timeout in case the scene wedges
  // (browser-tab-switch mid-animation, broken timer chain, etc.) so
  // the corner is never permanently occupied. The hard timeout is
  // generous (SCENE_HARD_TIMEOUT_MS) — it should never fire under
  // normal conditions.
  useEffect(() => {
    if (active === null) return;
    if (typeof window === "undefined") return;
    const fallback = window.setTimeout(() => {
      setActive(null);
    }, SCENE_HARD_TIMEOUT_MS);
    return () => window.clearTimeout(fallback);
  }, [active]);

  const onSceneComplete = useCallback(() => {
    setActive(null);
    // We deliberately DO NOT re-arm the idle timer here. The session
    // lock (firedThisSessionRef + sessionStorage) prevents another
    // fire this session anyway; re-arming would just churn a doomed
    // timer for the rest of the session.
  }, []);

  if (active === null) return null;
  return active.render(onSceneComplete);
}
