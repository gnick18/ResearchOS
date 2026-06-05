/**
 * Synthetic-Escape dispatch helper shared across walkthrough step bodies.
 *
 * Several walkthrough beats need to programmatically fire an Escape
 * keydown to drive a host surface (e.g. close a popup, commit an edit).
 * Those dispatches use `bubbles: true`, which means the synthetic keydown
 * reaches `window`. `TourController.tsx` listens on the window in capture
 * phase for Escape and surfaces the "Skip to the cleanup selector?"
 * confirm modal whenever it sees one. That listener can't distinguish a
 * user-pressed Escape from a tour-internal programmatic one, so the
 * confirm modal misfires whenever a step's own cursor script (or its
 * onExit) dispatches Escape (esc-skip-confirm misfire manager bug,
 * 2026-05-27 Grant hand-walk on §6.8).
 *
 * Fix: tag the synthetic event with `__tourSynthetic = true` before
 * dispatching. `TourController` checks for that flag on its keydown
 * listener and short-circuits, but host surfaces still see the event
 * normally, so the skip-confirm modal stays closed.
 *
 * Why a marker property (vs `stopPropagation` / scoping the dispatch to
 * a non-window target): popup Escape handlers also live on `window`, so
 * any dispatch that needs to reach them has to bubble to window. A
 * tagged-event sentinel is the smallest change that lets all listeners
 * coexist.
 */

/**
 * Sentinel property name attached to KeyboardEvents the walkthrough fires
 * programmatically. Kept as a module constant so the TourController and
 * the dispatching helpers can't drift on the string.
 */
export const TOUR_SYNTHETIC_ESC_MARKER = "__tourSynthetic" as const;

/**
 * Augmented KeyboardEvent shape — TypeScript view of the marker the
 * dispatcher stamps on. Consumers cast through this to read the flag
 * without `any`.
 */
export interface TourSyntheticKeyboardEvent extends KeyboardEvent {
  [TOUR_SYNTHETIC_ESC_MARKER]?: boolean;
}

/**
 * Returns true when the given keyboard event was dispatched by tour
 * internals (commitOpenEditAction, gantt-experiment popup-dismiss, etc.).
 * Used by `TourController` to skip the skip-confirm modal trigger.
 */
export function isTourSyntheticEscape(e: KeyboardEvent): boolean {
  return Boolean((e as TourSyntheticKeyboardEvent)[TOUR_SYNTHETIC_ESC_MARKER]);
}

/**
 * Build a KeyboardEvent with the tour-synthetic marker pre-stamped. Use
 * this in place of `new KeyboardEvent("keydown", ...)` whenever a
 * walkthrough beat needs to fire a programmatic Escape (or any other
 * synthetic key) that must NOT trigger the tour's own Escape-skip-confirm
 * listener.
 *
 * The event is otherwise identical to a plain `KeyboardEvent`: same
 * bubbles / cancelable semantics, same target after `dispatchEvent`.
 */
export function buildTourSyntheticKeyboardEvent(
  type: string,
  init: KeyboardEventInit,
): KeyboardEvent {
  const ev = new KeyboardEvent(type, init);
  try {
    Object.defineProperty(ev, TOUR_SYNTHETIC_ESC_MARKER, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch {
    // Some engines disallow defineProperty on Event in edge cases;
    // a plain assignment is good enough for the listener check.
    (ev as TourSyntheticKeyboardEvent)[TOUR_SYNTHETIC_ESC_MARKER] = true;
  }
  return ev;
}

/**
 * Convenience: dispatch a tour-synthetic Escape keydown on the given
 * target. `bubbles: true` so the host surface's own window-level
 * keydown listener still fires; the marker keeps the TourController
 * listener from misfiring. Returns true if the dispatch succeeded.
 *
 * No-op in non-DOM environments (SSR / vitest without jsdom config).
 */
export function dispatchTourSyntheticEscape(
  target: EventTarget,
): boolean {
  if (typeof KeyboardEvent === "undefined") return false;
  try {
    const ev = buildTourSyntheticKeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(ev);
    return true;
  } catch {
    return false;
  }
}
