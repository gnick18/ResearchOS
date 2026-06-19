// Multi-lab P2: production wiring for the member lab-view PULL.
//
// COMPANION to useLabWorkMirror (the push half). Where the mirror pushes a
// member's OWN folder to R2, this hook pulls the relay-assembled lab view back
// and materializes the shared-with-me records into the active member (OPFS)
// folder, so the existing folder-bound consumers light up.
//
// FLAG (CRITICAL): the entire hook is gated by LAB_AS_FOLDER_ENABLED. With the
// flag OFF it is a COMPLETE no-op (no subscribe, no interval, no listeners, no
// pull), so behavior is byte-identical to today. The flag check is the FIRST
// thing the effect does, before any side effect is registered.
//
// TRIGGERS mirror useLabWorkMirror exactly:
//   1. Session becoming live (controller.subscribe).
//   2. A periodic safety-net interval (default 5 min).
//   3. Window focus / tab becoming visible.
//   4. Debounced on-write signal via the react-query cache subscription. (A
//      co-member's write does not reach our cache, but the focus/periodic
//      triggers cover cross-member changes; the cache trigger keeps the pull in
//      step with our own session churn at no extra cost.)
//
// GUARDS: in-flight ref + min-interval ref, same as the push hook.
//
// ERROR POLICY: all pull errors are caught and logged as warnings, NEVER
// re-thrown into the render cycle. A failed pull leaves the previously
// materialized cache untouched so the next trigger retries.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LabSessionController } from "@/lib/lab/lab-session";
import { runLabViewPullForSession } from "@/lib/lab/lab-view-pull-runner";
import { LAB_AS_FOLDER_ENABLED } from "@/lib/lab/lab-as-folder-config";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * Injected dependencies for useLabViewPull. All have production defaults; inject
 * overrides in tests to avoid real I/O.
 */
export interface LabViewPullDepsHook {
  /** Run one pull cycle (default: runLabViewPullForSession). */
  runPull: typeof runLabViewPullForSession;
  /** Periodic pull interval in ms (default: 5 * 60 * 1000). */
  periodMs: number;
  /** Debounce delay for the on-write signal in ms (default: 30 * 1000). */
  debounceMs: number;
  /** Minimum interval between two completed pull runs in ms (default: 20 * 1000). */
  minIntervalMs: number;
  /** Epoch-ms clock (default: Date.now). Inject a controllable clock in tests. */
  now: () => number;
  /**
   * Override the flag gate (tests only). When omitted the hook reads the real
   * LAB_AS_FOLDER_ENABLED flag; with the flag off the hook is a complete no-op.
   */
  enabled?: boolean;
}

const defaultDeps: LabViewPullDepsHook = {
  runPull: runLabViewPullForSession,
  periodMs: 5 * 60 * 1000,
  debounceMs: 30 * 1000,
  minIntervalMs: 20 * 1000,
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// useLabViewPull
// ---------------------------------------------------------------------------

/**
 * Wires the four lab-view pull triggers for the current lab session, behind the
 * LAB_AS_FOLDER_ENABLED flag.
 *
 * Call from LabSignInGate alongside useLabWorkMirror. When the flag is off, or
 * controller is null, the hook does nothing. All effects are cleaned up on
 * unmount or when controller changes.
 *
 * @param controller  The LabSessionController from useLabSession, or null.
 * @param deps        Optional overrides for test injection.
 */
export function useLabViewPull(
  controller: LabSessionController | null,
  deps?: Partial<LabViewPullDepsHook>,
): void {
  const queryClient = useQueryClient();

  const mergedDeps = {
    ...defaultDeps,
    ...deps,
  };

  const depsRef = useRef(mergedDeps);
  depsRef.current = mergedDeps;

  const inFlightRef = useRef(false);
  const lastRunAtRef = useRef<number>(-Infinity);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIfLiveRef = useRef<() => void>(() => {});

  useEffect(() => {
    // FLAG GATE: the first thing the effect does. With the flag off (and no test
    // override forcing it on) NOTHING is registered, so flag-off is byte-identical.
    const flagOn = depsRef.current.enabled ?? LAB_AS_FOLDER_ENABLED;
    if (!flagOn) return;

    // No controller means this is not a lab user. Complete no-op.
    if (controller === null) return;

    async function runIfLive(): Promise<void> {
      const state = controller!.getState();
      if (state.kind !== "live") return;

      const d = depsRef.current;

      // In-flight guard: never overlap two runs.
      if (inFlightRef.current) return;

      // Min-interval guard: skip if the previous run finished very recently.
      if (d.now() - lastRunAtRef.current < d.minIntervalMs) return;

      inFlightRef.current = true;
      try {
        await d.runPull(state);
      } catch (err) {
        console.warn("[lab-view-pull] pull failed", err);
      } finally {
        lastRunAtRef.current = depsRef.current.now();
        inFlightRef.current = false;
      }
    }

    runIfLiveRef.current = () => void runIfLive();

    // Trigger 1: run on every transition (inspected inside runIfLive).
    const unsubscribe = controller.subscribe(() => {
      runIfLiveRef.current();
    });

    // Also attempt immediately (controller may already be live).
    runIfLiveRef.current();

    // Trigger 2: periodic safety-net.
    const intervalId = setInterval(() => {
      runIfLiveRef.current();
    }, depsRef.current.periodMs);

    // Trigger 3: window focus and tab visibility.
    const onFocus = () => runIfLiveRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        runIfLiveRef.current();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    // Trigger 4: debounced on-write signal via the react-query cache.
    const unsubscribeCache = queryClient.getQueryCache().subscribe(() => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        runIfLiveRef.current();
      }, depsRef.current.debounceMs);
    });

    return () => {
      unsubscribe();
      clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeCache();
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [controller, queryClient]);
}
