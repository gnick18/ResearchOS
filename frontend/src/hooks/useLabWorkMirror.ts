// Production wiring for the lab-work mirror push.
//
// DESIGN: mounts four sync triggers for a live lab session:
//   1. Session becoming live (via controller.subscribe).
//   2. A periodic safety-net interval (default 5 min).
//   3. Window focus / tab becoming visible (focus + visibilitychange events).
//   4. Debounced on-write signal via the react-query cache subscription.
//
// ON-WRITE SIGNAL: react-query does not expose a per-collection write event
// bus. We use queryClient.getQueryCache().subscribe() as a pragmatic proxy:
// it fires whenever any cached query is invalidated or updated, which happens
// after every write+invalidate in this app. This gives us a "something
// changed" signal without per-type instrumentation.
//
// GUARDS:
//   In-flight guard: a ref boolean prevents overlapping sync runs.
//   Min-interval guard: skips a run if the previous run finished fewer than
//   minIntervalMs milliseconds ago.
//
// ERROR POLICY: all sync errors are caught and logged as warnings. They are
// NEVER re-thrown into the render cycle or the gate. A failed sync leaves the
// previous manifest untouched so the next trigger retries it.
//
// MOUNTING: intended to be called once from LabSignInGate, which is already
// mounted around the app shell for every lab-account user. When controller is
// null the hook is a complete no-op.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LabSessionController } from "@/lib/lab/lab-session";
import { runLabSyncForSession } from "@/lib/lab/lab-sync-runner";
import { createLocalApiLabWorkSource } from "@/lib/lab/lab-work-source-localapi";
import { createFileServiceManifestStore } from "@/lib/lab/lab-sync-manifest-store";
import type { LabWorkSource } from "@/lib/lab/lab-work-enumerate";
import type { ManifestStore } from "@/lib/lab/lab-sync-manifest-store";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * Injected dependencies for useLabWorkMirror. All have production defaults;
 * inject overrides in tests to avoid real I/O.
 */
export interface LabWorkMirrorDeps {
  /** Run one sync cycle (default: runLabSyncForSession). */
  runSync: typeof runLabSyncForSession;
  /** Factory for the local-API work source (default: createLocalApiLabWorkSource). */
  makeSource: () => LabWorkSource;
  /** Factory for the manifest persistence store (default: createFileServiceManifestStore). */
  makeManifestStore: () => ManifestStore;
  /** Periodic sync interval in ms (default: 5 * 60 * 1000). */
  periodMs: number;
  /** Debounce delay for the on-write signal in ms (default: 30 * 1000). */
  debounceMs: number;
  /**
   * Minimum interval between two completed sync runs in ms (default: 20 * 1000).
   * A trigger that fires sooner than this after the last run completes is skipped.
   */
  minIntervalMs: number;
  /** Epoch-ms clock (default: Date.now). Inject a controllable clock in tests. */
  now: () => number;
}

const defaultDeps: LabWorkMirrorDeps = {
  runSync: runLabSyncForSession,
  makeSource: createLocalApiLabWorkSource,
  makeManifestStore: createFileServiceManifestStore,
  periodMs: 5 * 60 * 1000,
  debounceMs: 30 * 1000,
  minIntervalMs: 20 * 1000,
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// useLabWorkMirror
// ---------------------------------------------------------------------------

/**
 * Wires the four lab-work mirror push triggers for the current lab session.
 *
 * Call from LabSignInGate (which already holds the controller). When
 * controller is null the hook does nothing. All effects are cleaned up on
 * unmount or when controller changes.
 *
 * @param controller  The LabSessionController from useLabSession, or null.
 * @param deps        Optional overrides for test injection.
 */
export function useLabWorkMirror(
  controller: LabSessionController | null,
  deps?: Partial<LabWorkMirrorDeps>,
): void {
  const queryClient = useQueryClient();

  // Merge defaults with any injected overrides. Build inside the hook body
  // so React hooks rules are satisfied, but use stable refs so effects do not
  // need deps that change on every render.
  const mergedDeps = {
    ...defaultDeps,
    ...deps,
  };

  // Stable refs so the runIfLive closure always reads the latest values
  // without causing effect re-runs.
  const depsRef = useRef(mergedDeps);
  depsRef.current = mergedDeps;

  const inFlightRef = useRef(false);
  // Initialised to -Infinity so the very first run is never blocked by the
  // min-interval guard (no prior run has occurred yet).
  const lastRunAtRef = useRef<number>(-Infinity);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A stable reference to the core sync function so listeners can call it.
  // Defined as a ref to avoid stale closures in the effect cleanup chain.
  const runIfLiveRef = useRef<() => void>(() => {});

  useEffect(() => {
    // No controller means this is not a lab user. Complete no-op.
    if (controller === null) return;

    const d = depsRef.current;

    async function runIfLive(): Promise<void> {
      const state = controller!.getState();
      if (state.kind !== "live") return;

      // In-flight guard: never overlap two runs.
      if (inFlightRef.current) return;

      // Min-interval guard: skip if the previous run finished very recently.
      if (d.now() - lastRunAtRef.current < d.minIntervalMs) return;

      inFlightRef.current = true;
      try {
        await d.runSync(state, {
          source: d.makeSource(),
          manifestStore: d.makeManifestStore(),
        });
      } catch (err) {
        // Best-effort: log and continue. Never surface to the render cycle.
        console.warn("[lab-mirror] sync failed", err);
      } finally {
        lastRunAtRef.current = depsRef.current.now();
        inFlightRef.current = false;
      }
    }

    // Expose through a ref so the effect can reference it without capturing
    // stale state via closure.
    runIfLiveRef.current = () => void runIfLive();

    // Trigger 1: run once when the session becomes live. The subscribe
    // callback fires on EVERY state transition; we inspect inside runIfLive.
    const unsubscribe = controller.subscribe(() => {
      runIfLiveRef.current();
    });

    // Also attempt immediately (handles the case where the controller was
    // already live when this effect ran).
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
    // getQueryCache().subscribe fires on every cache event (updated,
    // invalidated, removed). We debounce to avoid hammering R2 on a burst of
    // rapid writes.
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
