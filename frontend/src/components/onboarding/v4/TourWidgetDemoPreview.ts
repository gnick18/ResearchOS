/**
 * §6.2b Home widgets walkthrough — demo-data preview flag
 * (tour-fixtures sub-bot R2, 2026-05-26).
 *
 * Problem the flag solves: a brand-new user walking through the §6.2b
 * cluster (canvas-intro / tile-anatomy / exit) sees real (empty) data
 * in their two pre-seeded home widgets. BeakerBot promises "the numbers
 * give you the gist at a glance" while the tile reads "Nothing queued"
 * and "Nothing on the calendar today". The lesson is dead on arrival.
 *
 * Fix shape: a module-level refcount-backed flag that home-widget
 * SnapshotTile components subscribe to via `useTourWidgetDemoPreview()`.
 * When the count is positive, widgets short-circuit their real data
 * hooks and render a small, plausible fixture so BeakerBot's pitch
 * lands. When the count drops back to zero, widgets return to their
 * real (empty) data path.
 *
 * Why a refcount rather than a boolean: the cluster's 3 step-bodies
 * each `pushTourWidgetDemoPreview()` on `onEnter` and pop on `onExit`.
 * Two adjacent steps both holding the flag means the count goes 1 → 2
 * → 1 across the transition rather than 1 → 0 → 1, which avoids a
 * one-frame flicker back to "Nothing queued" between steps. The
 * `useSyncExternalStore`-backed subscription handle re-renders any
 * mounted SnapshotTile synchronously, so the swap is jank-free.
 *
 * Why module-level (not a React Context): the §6.2b cluster mounts
 * SnapshotTiles inside `<SnapshotCanvas>` which lives under the
 * AppShell layout, several tree-levels deep from the V4MountForUser
 * `<TourControllerProvider>`. A Context-based fix would force every
 * widget surface (or the canvas itself) to thread a provider through,
 * which is more surface area than the small demo-preview need
 * justifies. A module-level subscribable store is the same pattern
 * `useAppStore` uses for cross-cutting state — purposeful, narrow,
 * inspectable.
 *
 * No file-system layer touched: the fixture data is inline in each
 * widget body (one demo array per snapshot). The wikiCapture fixture
 * path remains the dedicated route for full-data screenshot capture;
 * this flag is the lighter UI-only override for tour-step demos. */
"use client";

import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Module-level state + subscribers
// ─────────────────────────────────────────────────────────────────────────

let activeRefcount = 0;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  // Iterate over a snapshot in case a subscriber unsubscribes
  // synchronously while we're notifying. Set iteration semantics
  // would also tolerate it, but a snapshot is the defensive default.
  for (const sub of [...subscribers]) {
    try {
      sub();
    } catch (err) {
      // A throwing subscriber must not block other subscribers from
      // hearing the update. Mirrors the contract of EventTarget /
      // zustand's emit path.
      console.error("[tour-widget-demo] subscriber threw:", err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API — refcount handle
// ─────────────────────────────────────────────────────────────────────────

/**
 * Push a demo-preview lease onto the stack. Returns a release function
 * the caller MUST call (typically inside the step body's `onExit`) to
 * pop the lease. While at least one lease is held, widgets that
 * subscribe via `useTourWidgetDemoPreview()` render fixture data
 * instead of their real data path.
 *
 * The returned release function is idempotent: calling it twice
 * decrements the refcount once and then no-ops. This protects against
 * an `onExit` that fires twice (effect cleanup + step-change cleanup)
 * from dragging the refcount negative.
 *
 * Cross-step transition note (tour-fixtures sub-bot R2, 2026-05-26):
 * when two §6.2b cluster steps both hold a lease and the user advances
 * from one to the next, the TourController schedules the old step's
 * `onExit` (the release) as a microtask BEFORE the new step's
 * `onEnter` (the next push) runs. To avoid the refcount briefly
 * dropping to 0 in that microtask gap (which would flicker the
 * snapshot tiles back to "Nothing queued" for one frame), the release
 * is deferred to a `queueMicrotask` callback — that defers it one
 * microtask hop, letting the next step's synchronous push run first.
 * The net refcount trace across canvas-intro → tile-anatomy is:
 *
 *   onEnter(canvas-intro) push: refcount 1
 *   ... user reads, advances ...
 *   onExit(canvas-intro)  queue release    (microtask scheduled)
 *   onEnter(tile-anatomy) push: refcount 2 (synchronous)
 *   queued release runs:        refcount 1 (microtask fires)
 *
 * Net: never drops to 0, no flicker. */
export function pushTourWidgetDemoPreview(): () => void {
  activeRefcount += 1;
  notifySubscribers();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Defer one microtask hop so a sibling step's onEnter push that
    // races our release lands BEFORE the decrement (see header note).
    queueMicrotask(() => {
      activeRefcount = Math.max(0, activeRefcount - 1);
      notifySubscribers();
    });
  };
}

/** True iff at least one demo-preview lease is currently held. Pure
 *  read — does not subscribe. Useful in non-React code paths (e.g.
 *  tests, callbacks) where the React hook isn't usable. */
export function isTourWidgetDemoPreviewActive(): boolean {
  return activeRefcount > 0;
}

/** TEST-ONLY: hard-reset the refcount to zero. Production code must
 *  pair every push with its release; this escape hatch exists so a
 *  test that intentionally simulates a leak can clean up between
 *  cases without polluting the next test. */
export function __resetTourWidgetDemoPreviewForTests(): void {
  activeRefcount = 0;
  notifySubscribers();
}

// ─────────────────────────────────────────────────────────────────────────
// React hook
// ─────────────────────────────────────────────────────────────────────────

function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function getSnapshot(): boolean {
  return activeRefcount > 0;
}

function getServerSnapshot(): boolean {
  // SSR / static-export builds never have the tour active, and the
  // refcount lives in client memory anyway. Returning `false`
  // matches the hydration contract: the first client render starts
  // from the same "no tour preview" baseline.
  return false;
}

/**
 * React hook: returns `true` while at least one demo-preview lease is
 * held, `false` otherwise. Subscribing components re-render
 * synchronously when the flag flips so the widget swap is immediate.
 *
 * Usage inside a SnapshotTile body:
 *
 *   export function SnapshotTile() {
 *     const demo = useTourWidgetDemoPreview();
 *     if (demo) return <DemoFixtureTile />;
 *     // ...real data path
 *   }
 */
export function useTourWidgetDemoPreview(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
