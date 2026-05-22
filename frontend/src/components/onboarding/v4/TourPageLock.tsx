"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * TourPageLock — page-wide click guard with an allow-list of safe
 * affordances during user-action steps (Onboarding v4 Gantt redesign,
 * Gantt manager 2026-05-22).
 *
 * Why this exists (vs InputLockOverlay):
 *  - `InputLockOverlay` is the BeakerBot-cursor-demo lock: it blocks
 *    EVERY user click for the duration of a cursor script. That's the
 *    right contract while BeakerBot is the actor.
 *  - The new §6.8 user-action steps (`gantt-deps-user`,
 *    `gantt-share-user-shares-back`, etc.) need the OPPOSITE: BeakerBot
 *    is silent, the USER is the actor, but only certain affordances are
 *    valid. Clicking anywhere else should not silently do nothing — it
 *    should surface a friendly "Oops, try X" prompt and prevent the
 *    wrong-target side-effect from firing.
 *
 * Allow-list contract:
 *  - `allowedTargets` is an array of `data-tour-target` attribute values.
 *    A click whose target (or any ancestor) carries one of those attrs
 *    is let through. Everything else is blocked.
 *  - The speech bubble + skip / back affordances ALWAYS pass through so
 *    the user has an escape hatch (matches InputLockOverlay's contract).
 *  - When `null` is passed for `allowedTargets`, the lock is disabled
 *    (no overlay rendered).
 *
 * Wrong-click behavior:
 *  - The component dispatches a window-level custom event
 *    `tour:page-lock-wrong-click` so the controller can surface a
 *    speech-bubble flash. Keeping the speech text out of this component
 *    keeps it dumb + reusable; the step body owns the copy.
 *  - The wrong click is `preventDefault`-ed + `stopPropagation`-ed so
 *    the wrong UI affordance never fires its handler.
 *
 * Layering:
 *  - Same z-index band as InputLockOverlay (z-[420]). Both can't be
 *    active simultaneously by construction: cursor demos turn
 *    InputLockOverlay on; user-action steps turn TourPageLock on; the
 *    TourController flips between them per step.
 *  - Window-level capture listeners (mousedown + click) — same pattern
 *    as InputLockOverlay so capture-phase blocks beat any in-page
 *    bubble-phase handler.
 *
 * What this does NOT do:
 *  - It does not block scroll. User-action steps benefit from the user
 *    being able to scroll the page to find the target.
 *  - It does not block typing. Some allow-list steps include a text
 *    input inside the popup (e.g. notes textarea); keystrokes go to
 *    whichever element has focus, which the user already clicked into.
 */

interface TourPageLockProps {
  /** When null, the lock is disabled. Otherwise an array of allowed
   *  `data-tour-target` attribute values. */
  allowedTargets: readonly string[] | null;
}

/** Selector used to identify the speech bubble (and its children) so
 *  user clicks on Skip / Back / Got-it always land normally. Matches
 *  InputLockOverlay's identical selector. */
const SPEECH_BUBBLE_SELECTOR =
  '[data-testid="tour-beakerbot-bubble"], [data-testid="tour-beakerbot-overlay"]';

/** Custom event the lock dispatches when the user clicks something
 *  outside the allow-list. The TourController listens for this and
 *  flashes the configured "Oops" copy in the speech bubble. */
export const PAGE_LOCK_WRONG_CLICK_EVENT = "tour:page-lock-wrong-click";

/** Detail payload on the wrong-click custom event. */
export interface PageLockWrongClickDetail {
  /** The element the user actually clicked. Exposed so future debug
   *  surfaces can show "you clicked X" — current consumers just want
   *  the "Oops" copy. */
  target: EventTarget | null;
  /** Timestamp the click landed, ms since epoch. */
  at: number;
}

/**
 * Test if an event target lives inside the speech bubble. Same shape
 * as InputLockOverlay's helper of the same name — kept private here
 * so the two components don't share a stale import edge.
 */
function isInsideSpeechBubble(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(SPEECH_BUBBLE_SELECTOR);
}

/**
 * Test if an event target (or any ancestor) carries one of the allowed
 * `data-tour-target` attributes. Exported for the unit test.
 */
export function isOnAllowList(
  target: EventTarget | null,
  allowedTargets: readonly string[],
): boolean {
  if (!(target instanceof Element)) return false;
  // Build the OR-of-attribute selector once. With 3-5 targets typical,
  // a single `closest()` over a joined attribute selector is faster +
  // simpler than iterating.
  const selector = allowedTargets
    .map((t) => `[data-tour-target="${cssEscape(t)}"]`)
    .join(", ");
  if (!selector) return false;
  return !!target.closest(selector);
}

/** Minimal CSS.escape polyfill for the rare double-quote inside the
 *  attribute value. The allow-list values are kebab-case so this is
 *  defensive; the polyfill handles a stray quote without breaking the
 *  selector parse. */
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/"/g, '\\"');
}

export default function TourPageLock({ allowedTargets }: TourPageLockProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot client mount detection so the portal target is safe.
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!allowedTargets) return;
    if (typeof window === "undefined") return;

    const handleClick = (e: Event) => {
      // BeakerBotCursor sets this flag during its own programmatic
      // clicks. The page-lock is for USER clicks only; cursor clicks
      // (which only fire during a cursor demo, and during a cursor
      // demo the InputLockOverlay owns the lock) sneak through.
      if (
        (window as unknown as { __beakerBotCursorClicking?: boolean })
          .__beakerBotCursorClicking
      ) {
        return;
      }
      // Speech bubble always passes through (Skip / Back / Got-it).
      if (isInsideSpeechBubble(e.target)) return;
      // Allow-listed elements pass through.
      if (isOnAllowList(e.target, allowedTargets)) return;
      // Wrong click — block it + signal the controller.
      e.preventDefault();
      e.stopPropagation();
      try {
        window.dispatchEvent(
          new CustomEvent<PageLockWrongClickDetail>(
            PAGE_LOCK_WRONG_CLICK_EVENT,
            {
              detail: { target: e.target, at: Date.now() },
            },
          ),
        );
      } catch {
        // Custom event construction can fail in very old jsdom configs;
        // the click is still blocked, just no speech bubble flash.
      }
    };

    const opts = { capture: true, passive: false } as const;
    window.addEventListener("click", handleClick, opts);
    window.addEventListener("mousedown", handleClick, opts);

    return () => {
      window.removeEventListener("click", handleClick, opts);
      window.removeEventListener("mousedown", handleClick, opts);
    };
  }, [allowedTargets]);

  if (!mounted || !allowedTargets) return null;

  return createPortal(
    <div
      data-testid="tour-page-lock-overlay"
      aria-hidden
      // pointer-events: none so the overlay div itself never blocks a
      // click. The window-level capture listener is what does the
      // actual gating. Setting pointer-events: auto here would block
      // EVERY click (defeating the allow-list); we want capture-phase
      // listener gating only.
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 419,
        pointerEvents: "none",
      }}
    />,
    document.body,
  );
}
