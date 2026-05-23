"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Input lock overlay for the Onboarding v4 in-product walkthrough
 * (Bug B, sub-bot 2026-05-21).
 *
 * Grant's report: "block the user from kind of clicking anything or
 * scrolling anything on the screen when BeakerBot is actively typing
 * using the cursor." Without this, the user can scroll the page or
 * click random buttons mid-cursor-script, the cursor's pre-computed
 * coordinates go stale, clicks land on the wrong elements, and the
 * tour wedges.
 *
 * Render contract:
 *  - Mounted only while `active` is true (the TourController flips this
 *    to true at `runScript` start, back to false when the script
 *    resolves or the step exits).
 *  - Portal'd into document.body at z-[420] — above the TourSpotlight
 *    glow (z-[400] on the cursor itself; spotlights stack lower) and
 *    BELOW the speech bubble (`tour-beakerbot-overlay` at z-[450]) so
 *    Skip / Back / "Got it" remain clickable when a cursor demo wedges.
 *  - A very subtle dim layer (`bg-black/5`) is the user's hint that the
 *    page isn't interactive — visible enough to read as "wait" but not
 *    so loud it competes with the cursor animation.
 *  - The "BeakerBot is demonstrating" pill sits at the bottom-center
 *    with a pulsing dot so the wait state has a friendly anchor; the
 *    pill DOES NOT overlap the speech bubble (which is anchored
 *    bottom-right).
 *
 * Event-blocking contract:
 *  - `wheel` + `touchmove` (capture phase) — `preventDefault` +
 *    `stopPropagation` so the page can't scroll. Capture-phase listeners
 *    fire BEFORE any other handler so e.g. a CodeMirror wheel handler
 *    inside the page can't beat us.
 *  - `click` (capture phase) — `preventDefault` + `stopPropagation`.
 *    The cursor's programmatic `element.click()` bypasses the overlay
 *    entirely (it dispatches directly on the target without traversing
 *    the document's pointer-event tree, since JS-initiated click events
 *    aren't filtered by `pointer-events: none` on ancestors); only USER
 *    clicks hit this listener.
 *  - The speech bubble (`[data-testid="tour-beakerbot-bubble"]` and the
 *    speech-bubble children) is allowlisted: a user-click whose target
 *    or ancestor matches the bubble selector is allowed through so
 *    Skip / Back / Got-it stay reachable as escape hatches.
 *  - Keyboard input is NOT blocked: the brief calls this optional and
 *    keeping Tab + Enter free for the speech bubble's accessibility
 *    matters more than a maximalist lock. The bubble's buttons are still
 *    keyboard-reachable.
 *
 * Layering note: the overlay uses `pointer-events: auto` on its fixed
 * inset div (so it actually receives the click events to block) but
 * keeps the pill + dim layer non-interactive otherwise. The capture-
 * phase listeners are added to `window` (not the overlay div) so they
 * fire on every event before bubbling — this is more reliable than
 * listening on the div, since wheel events on the WINDOW itself never
 * dispatch on a fixed-position div.
 */

interface InputLockOverlayProps {
  /** Render + activate event blocking when true. */
  active: boolean;
}

/** Selector used to identify the speech bubble (and its children) so
 *  user clicks on Skip / Back / Got-it land normally. The bubble lives
 *  inside `[data-testid="tour-beakerbot-overlay"]` (the outer non-
 *  interactive anchor) → `[data-testid="tour-beakerbot-bubble"]` (the
 *  interactive bubble). Checking either lets the user's escape hatch
 *  survive even if a future polish round shuffles the wrapper. */
const SPEECH_BUBBLE_SELECTOR =
  '[data-testid="tour-beakerbot-bubble"], [data-testid="tour-beakerbot-overlay"]';

/**
 * Test if an event target is inside the speech bubble (and therefore
 * should be allowed through). Exported for the unit tests so the
 * allowlist contract doesn't drift silently.
 */
export function isInsideSpeechBubble(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(SPEECH_BUBBLE_SELECTOR);
}

export default function InputLockOverlay({ active }: InputLockOverlayProps) {
  // Client-only portal mount — same pattern as the rest of the v4
  // overlay surfaces (TourSpotlight, BeakerBotCursor). Without the
  // mounted gate, `createPortal(document.body)` throws during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot client mount detection so the portal target is safe.
    setMounted(true);
  }, []);

  // Attach + tear down the capture-phase window event listeners when
  // `active` flips. Using window-level capture listeners is more
  // reliable than div-level handlers because wheel events fire on the
  // window itself when the mouse is over a scrollable region — a div
  // sitting fixed at inset-0 would never see them unless the cursor
  // happens to be over the div's geometry at the moment of the scroll
  // (and even then, scrollable ancestors can absorb the wheel event
  // before it reaches the div).
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;

    const blockEvent = (e: Event) => {
      // BeakerBotCursor sets `window.__beakerBotCursorClicking = true`
      // for the duration of its own `el.click()` so the overlay's
      // capture-phase blocker can short-circuit (Grant 2026-05-21
      // follow-up: §6.4 New Category and Create Empty clicks were
      // animating but never actually triggering because this listener
      // stopPropagation'd before React's delegated handler ran).
      if (
        typeof window !== "undefined" &&
        (window as unknown as { __beakerBotCursorClicking?: boolean })
          .__beakerBotCursorClicking
      ) {
        return;
      }
      // Skip + Back + Got-it (speech bubble) ALWAYS go through so the
      // user has an escape hatch when the cursor wedges. Without this
      // exception, a stuck cursor would lock the user out of every way
      // to break out.
      if (isInsideSpeechBubble(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    // Cast for TS — addEventListener with `capture: true` is shorthand
    // for the options object form.
    const opts = { capture: true, passive: false } as const;
    window.addEventListener("wheel", blockEvent, opts);
    window.addEventListener("touchmove", blockEvent, opts);
    window.addEventListener("click", blockEvent, opts);
    window.addEventListener("mousedown", blockEvent, opts);

    // Wave 2 Fix 7/9: keyboard scroll lock. Block the keys that would
    // scroll the page mid-cursor-script (Space, PageUp/Down, Home,
    // End, Arrow keys) so the cursor's pre-computed coordinates stay
    // valid. Modifier-combo presses (Cmd+ArrowDown, Ctrl+Home etc.)
    // pass through for power-user nav; Tab/Shift+Tab/Enter always
    // pass so the speech bubble's accessibility surface keeps
    // working. Any key whose target lives inside the speech bubble
    // also passes so a focused Skip / Back / Got-it button can be
    // keyboard-activated.
    const blockKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isInsideSpeechBubble(e.target)) return;
      const scrollKeys = new Set([
        " ",
        "Spacebar",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ]);
      if (!scrollKeys.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", blockKey, opts);

    return () => {
      window.removeEventListener("wheel", blockEvent, opts);
      window.removeEventListener("touchmove", blockEvent, opts);
      window.removeEventListener("click", blockEvent, opts);
      window.removeEventListener("mousedown", blockEvent, opts);
      window.removeEventListener("keydown", blockKey, opts);
    };
  }, [active]);

  if (!mounted || !active) return null;

  return createPortal(
    <div
      data-testid="tour-input-lock-overlay"
      // pointer-events: auto so the dim layer itself can absorb pointer
      // hovers (no underlying buttons can show their hover state through
      // the lock). The window-level listeners do the actual click block;
      // this just makes the layer feel solid.
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 420,
        pointerEvents: "auto",
        // Very faint dim — Grant said "not in their face"; this is
        // about 5% black, enough that a careful eye notices but it
        // doesn't compete with the cursor or the bubble.
        backgroundColor: "rgba(0, 0, 0, 0.05)",
        // Subtle wait cursor so the OS hint that the page isn't
        // interactive lines up with the visual hint.
        cursor: "wait",
      }}
    >
      <div
        data-testid="tour-input-lock-pill"
        // Bottom-center pill. The speech bubble sits bottom-right
        // (right-6, bottom: 96), so a bottom-center anchor doesn't
        // overlap. Pointer-events: none so it isn't a click target;
        // the outer fixed div is the catcher.
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(15, 23, 42, 0.88)", // slate-900/88
          color: "white",
          fontSize: 12,
          fontWeight: 500,
          padding: "8px 14px",
          borderRadius: 9999,
          boxShadow: "0 4px 10px rgba(0, 0, 0, 0.2)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <span
          aria-hidden
          // Pulsing dot — same sky-blue as BeakerBot so the visual ties
          // back to the mascot. The animation is a soft opacity pulse,
          // not a movement, so it doesn't trigger reduced-motion concerns.
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "#0ea5e9", // sky-500
            animation: "tour-input-lock-pulse 1.4s ease-in-out infinite",
          }}
        />
        BeakerBot is demonstrating — please wait
      </div>
      <style>{`
        @keyframes tour-input-lock-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
