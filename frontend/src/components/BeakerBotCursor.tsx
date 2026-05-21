"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * BeakerBotCursor — an overlay cursor that floats above the app and
 * performs four "primitive" actions on real product surfaces:
 *
 *   1. **Glide**  — animate the cursor's screen position to (x, y)
 *      over ~800-900ms via a CSS transform transition. Tuned up from
 *      the original 300-500ms band after Grant's v4 round-3 testing —
 *      the faster default made step transitions too easy to miss
 *      ("the first step is happening so freaking fast"), so the glide
 *      now reads as a slow, trackable arc the user can follow even at
 *      120px BeakerBot tour size on a typical monitor. Click ripple
 *      stays at ~150ms (it's an attention beat, not a path) and the
 *      typewriter cadence stays at ~95ms.
 *   2. **Click**  — emit a brief ripple animation at the cursor tip,
 *      then programmatically fire `target.click()` so the app handles
 *      the event normally.
 *   3. **Type**   — focus an input/textarea, then type a string one
 *      character at a time at ~95ms cadence (matching the existing
 *      use-typewriter prose pacing). Works for both native `<input>` /
 *      `<textarea>` and `[contenteditable]` elements.
 *   4. **Drag**   — glide to a source element, enter "pressed" visual
 *      state, glide to a destination element with the pressed state
 *      held, then release. Programmatically dispatches the underlying
 *      mousedown → mousemove → mouseup sequence (HTML5 DnD is
 *      delegated to receivers that listen for those events; senders
 *      that only listen for `dragstart` etc. need a different
 *      dispatch sequence which a caller can layer on top).
 *
 * The cursor mounts via React portal at `document.body` so it floats
 * above ALL app chrome including modals (`z-[400]` clears the highest
 * modal observed at `z-[210]`).
 *
 * **Controller pattern.** Exposed via `useImperativeHandle` so the
 * tour controller (P1) and any future demo composers can call the
 * primitives ergonomically:
 *
 *   const cursorRef = useRef<BeakerBotCursorRef>(null);
 *   await cursorRef.current?.glideTo(120, 240);
 *   await cursorRef.current?.clickAt(buttonEl);
 *   await cursorRef.current?.typeInto(inputEl, "hello", 95);
 *   await cursorRef.current?.dragFromTo(srcEl, destEl);
 *
 * Each primitive returns a Promise that resolves AFTER the animation
 * completes and the underlying DOM event fires — composable enough to
 * sequence whole walkthroughs without manual delays.
 *
 * **Reduced motion.** When `prefers-reduced-motion: reduce` is set:
 *   - Glide skips to the end state instantly (no transition).
 *   - Click ripple still fires (a single fade, not motion-sickness
 *     inducing per WCAG guidance — comparable to a status spinner).
 *   - Type still types at cadence (could be sped up; out of scope for
 *     P2 — left at 95ms for narrative consistency).
 *   - Drag skips to the destination instantly with no pressed-state
 *     glide between endpoints.
 *
 * Lives alongside BeakerBot (not inside) per L18 — reusable beyond
 * onboarding (future power-user "watch BeakerBot do this for me"
 * demos can drive the same component).
 */

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type CursorAction =
  | { type: "glide"; x: number; y: number }
  | { type: "click"; target: HTMLElement }
  | { type: "type"; target: HTMLElement; text: string; cadenceMs?: number }
  | { type: "drag"; source: HTMLElement; dest: HTMLElement };

export interface BeakerBotCursorRef {
  /** Glide to absolute viewport coords (x, y). Resolves on arrival. */
  glideTo(x: number, y: number): Promise<void>;
  /** Glide to the element's center, then ripple + fire `target.click()`. */
  clickAt(el: HTMLElement): Promise<void>;
  /** Glide to the element, focus it, then type chars at cadenceMs each. */
  typeInto(el: HTMLElement, text: string, cadenceMs?: number): Promise<void>;
  /** Glide to source → press → glide to dest → release; dispatches
   *  matching mouse events on each end so the app's handlers see it. */
  dragFromTo(source: HTMLElement, dest: HTMLElement): Promise<void>;
  /** Hide the cursor (display: none). */
  hide(): void;
  /** Show the cursor (default visibility). */
  show(): void;
  /** Run a queue of primitives sequentially. Resolves after the last. */
  runScript(actions: readonly CursorAction[]): Promise<void>;
}

export interface BeakerBotCursorProps {
  /** Initial cursor position. Defaults to off-screen (-100, -100) so
   *  the cursor doesn't flash at (0,0) before its first glide. */
  initialX?: number;
  initialY?: number;
  /** Glide duration in ms. Default 850 (within the 800-900ms band
   *  set by v4 polish round 3, bumped from the original 400ms after
   *  Grant flagged first-step glides as too fast to track). */
  glideMs?: number;
  /** Click ripple duration in ms. Default 150 per L17. */
  rippleMs?: number;
  /** Default type cadence in ms per character. Default 95 per L17. */
  typeCadenceMs?: number;
  /** Optional className passthrough on the outer wrapper. Useful for
   *  tests to query the cursor without depending on data-testid. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Animation defaults
// ---------------------------------------------------------------------------

const DEFAULT_GLIDE_MS = 850;
const DEFAULT_RIPPLE_MS = 150;
const DEFAULT_TYPE_CADENCE_MS = 95;
/** Cubic-bezier matching the brief — "natural feel" easing. */
const GLIDE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

// ---------------------------------------------------------------------------
// Utility: detect reduced-motion preference, SSR-safe
// ---------------------------------------------------------------------------

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Utility: center coords of an element via getBoundingClientRect
// ---------------------------------------------------------------------------

function elementCenter(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

// ---------------------------------------------------------------------------
// Utility: native value setter for React-controlled inputs
//
// React tracks an input's value via a private property on the DOM node;
// just doing `el.value = "x"` won't fire the synthetic onChange in
// React-controlled forms. The canonical fix is to call the native
// Object setter, then dispatch a synthetic input event — this is what
// React's `simulateChangeEvent` does internally and what every guide
// on programmatic React input control recommends.
// ---------------------------------------------------------------------------

function setNativeInputValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const tag = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(tag.prototype, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Utility: small Promise-based sleep
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    window.setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Internal state — kept in refs so the imperative methods don't cause
 * re-renders for every position update. The visible position is
 * controlled via inline `transform: translate3d(...)` driven by a
 * style ref → element so each glide is a single style write.
 */
interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
  ripples: number[]; // ripple ids; rendered as <span>s that auto-fade
}

const BeakerBotCursor = forwardRef<BeakerBotCursorRef, BeakerBotCursorProps>(
  function BeakerBotCursor(
    {
      initialX = -100,
      initialY = -100,
      glideMs = DEFAULT_GLIDE_MS,
      rippleMs = DEFAULT_RIPPLE_MS,
      typeCadenceMs = DEFAULT_TYPE_CADENCE_MS,
      className,
    },
    ref,
  ) {
    // Client-only portal mount. SSR returns null until mounted.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection: render nothing on the server, then flip to mounted on client mount so createPortal(document.body) is safe to call. Same pattern as OnboardingTipCard.tsx.
      setMounted(true);
    }, []);

    // Cursor visual state. We use a single state object + a ref mirror
    // so the imperative methods can read the latest position without
    // racing the React commit.
    const [state, setState] = useState<CursorState>({
      x: initialX,
      y: initialY,
      visible: true,
      pressed: false,
      ripples: [],
    });
    // Stable refs for tuning props + state so the imperative callbacks
    // read the latest values without resubscribing. Mirrored in an
    // effect (NOT during render — React's rules-of-hooks lints flag
    // ref-write-during-render as it can desync with concurrent
    // rendering retries).
    const glideMsRef = useRef(glideMs);
    const rippleMsRef = useRef(rippleMs);
    const typeCadenceMsRef = useRef(typeCadenceMs);
    useEffect(() => {
      glideMsRef.current = glideMs;
      rippleMsRef.current = rippleMs;
      typeCadenceMsRef.current = typeCadenceMs;
    }, [glideMs, rippleMs, typeCadenceMs]);

    // Reduced-motion media query, live (a user can toggle the OS
    // preference mid-tour; we want to honor that).
    const [reduced, setReduced] = useState<boolean>(() =>
      readPrefersReducedMotion(),
    );
    useEffect(() => {
      if (typeof window === "undefined" || !window.matchMedia) return;
      let mql: MediaQueryList;
      try {
        mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      } catch {
        return;
      }
      const onChange = () => setReduced(mql.matches);
      // addEventListener is the modern API; older Safari needs addListener
      // but we target current evergreen browsers + jsdom which support
      // addEventListener. Guard anyway for safety.
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      return undefined;
    }, []);
    const reducedRef = useRef(reduced);
    useEffect(() => {
      reducedRef.current = reduced;
    }, [reduced]);

    // ---------------------------------------------------------------------
    // Primitive: Glide
    // ---------------------------------------------------------------------
    const glideTo = useCallback(async (x: number, y: number): Promise<void> => {
      setState((prev) => ({ ...prev, x, y }));
      // For reduced motion the transition is disabled (see render), so
      // the position update is instant — resolve next tick to let React
      // commit the new transform.
      if (reducedRef.current) {
        await sleep(0);
        return;
      }
      await sleep(glideMsRef.current);
    }, []);

    // ---------------------------------------------------------------------
    // Primitive: Click
    // ---------------------------------------------------------------------
    const clickAt = useCallback(
      async (el: HTMLElement): Promise<void> => {
        const { x, y } = elementCenter(el);
        await glideTo(x, y);
        // Ripple: push a new ripple id, schedule its removal.
        const rippleId = Date.now() + Math.random();
        setState((prev) => ({ ...prev, ripples: [...prev.ripples, rippleId] }));
        // Fire the real click slightly after the ripple becomes visible
        // so the user perceives the click visually before the app
        // event lands. ~30ms is a single animation frame at 30fps —
        // imperceptible delay but ordering is preserved.
        await sleep(30);
        try {
          el.click();
        } catch {
          // No-op: if click() throws (e.g. detached node), we still
          // resolve so the calling script doesn't deadlock.
        }
        // Wait for the ripple animation to finish, then prune it.
        await sleep(rippleMsRef.current);
        setState((prev) => ({
          ...prev,
          ripples: prev.ripples.filter((r) => r !== rippleId),
        }));
      },
      [glideTo],
    );

    // ---------------------------------------------------------------------
    // Primitive: Type
    // ---------------------------------------------------------------------
    const typeInto = useCallback(
      async (
        el: HTMLElement,
        text: string,
        cadenceMs?: number,
      ): Promise<void> => {
        const cadence = cadenceMs ?? typeCadenceMsRef.current;
        const { x, y } = elementCenter(el);
        await glideTo(x, y);
        // Focus the target. For inputs/textareas, also click() so the
        // app's onFocus + cursor-position logic fires naturally.
        try {
          el.focus();
        } catch {
          // jsdom occasionally throws on focus of unmountable nodes.
        }

        const isNativeInput =
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

        if (isNativeInput) {
          // Type char-by-char into a native form control via the
          // React-safe setter.
          const startingValue = el.value;
          for (let i = 0; i < text.length; i++) {
            setNativeInputValue(el, startingValue + text.slice(0, i + 1));
            // Reduced motion: still respect cadence so the test's
            // intent (cursor types into the input) is observable.
            // The brief allows this — "could be sped up; out of scope."
            await sleep(cadence);
          }
        } else {
          // Generic fallback: append text to `textContent` char-by-char.
          // Suitable for contenteditable or any neutral container that
          // wants to show the typing as a visual progression. Real
          // contenteditable RTE integrations can subscribe to a
          // different bus; this is the safe default for the primitive.
          const startingText = el.textContent ?? "";
          for (let i = 0; i < text.length; i++) {
            el.textContent = startingText + text.slice(0, i + 1);
            await sleep(cadence);
          }
        }
      },
      [glideTo],
    );

    // ---------------------------------------------------------------------
    // Primitive: Drag
    // ---------------------------------------------------------------------
    const dragFromTo = useCallback(
      async (source: HTMLElement, dest: HTMLElement): Promise<void> => {
        const src = elementCenter(source);
        const dst = elementCenter(dest);

        // 1. Glide to source.
        await glideTo(src.x, src.y);

        // 2. Press — fire mousedown on source, switch to pressed visual.
        setState((prev) => ({ ...prev, pressed: true }));
        try {
          source.dispatchEvent(
            new MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              clientX: src.x,
              clientY: src.y,
              button: 0,
            }),
          );
        } catch {
          // No-op
        }

        // 3. Glide to destination with pressed state held. Reduced
        // motion skips the glide animation entirely; we still fire an
        // interim mousemove on the source for handlers that watch the
        // drag path.
        if (!reducedRef.current) {
          // Mid-drag mousemove so drag-aware libraries see motion.
          try {
            source.dispatchEvent(
              new MouseEvent("mousemove", {
                bubbles: true,
                cancelable: true,
                clientX: (src.x + dst.x) / 2,
                clientY: (src.y + dst.y) / 2,
                button: 0,
              }),
            );
          } catch {
            // No-op
          }
        }
        await glideTo(dst.x, dst.y);

        // 4. Final mousemove on dest at arrival, then mouseup → release.
        try {
          dest.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              cancelable: true,
              clientX: dst.x,
              clientY: dst.y,
              button: 0,
            }),
          );
          dest.dispatchEvent(
            new MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              clientX: dst.x,
              clientY: dst.y,
              button: 0,
            }),
          );
        } catch {
          // No-op
        }
        setState((prev) => ({ ...prev, pressed: false }));
      },
      [glideTo],
    );

    // ---------------------------------------------------------------------
    // Primitive: hide/show
    // ---------------------------------------------------------------------
    const hide = useCallback(() => {
      setState((prev) => ({ ...prev, visible: false }));
    }, []);
    const show = useCallback(() => {
      setState((prev) => ({ ...prev, visible: true }));
    }, []);

    // ---------------------------------------------------------------------
    // Composable script runner
    // ---------------------------------------------------------------------
    const runScript = useCallback(
      async (actions: readonly CursorAction[]): Promise<void> => {
        for (const action of actions) {
          switch (action.type) {
            case "glide":
              await glideTo(action.x, action.y);
              break;
            case "click":
              await clickAt(action.target);
              break;
            case "type":
              await typeInto(action.target, action.text, action.cadenceMs);
              break;
            case "drag":
              await dragFromTo(action.source, action.dest);
              break;
            default: {
              // Exhaustiveness check — TS will yell if a new action
              // type is added without a case here.
              const _exhaustive: never = action;
              void _exhaustive;
            }
          }
        }
      },
      [glideTo, clickAt, typeInto, dragFromTo],
    );

    // Expose the imperative API.
    useImperativeHandle(
      ref,
      () => ({
        glideTo,
        clickAt,
        typeInto,
        dragFromTo,
        hide,
        show,
        runScript,
      }),
      [glideTo, clickAt, typeInto, dragFromTo, hide, show, runScript],
    );

    // ---------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------
    const transitionStyle = useMemo<React.CSSProperties>(() => {
      // The transform is the only animated property; reduced motion
      // turns it off entirely so position updates are instant.
      const transition = reduced
        ? "none"
        : `transform ${glideMs}ms ${GLIDE_EASING}`;
      return {
        position: "fixed",
        top: 0,
        left: 0,
        transform: `translate3d(${state.x}px, ${state.y}px, 0)`,
        transition,
        // Don't intercept pointer events — the cursor is a visual
        // overlay, not an interactive element.
        pointerEvents: "none",
        // Above all observed modals (highest seen: z-[210]). Leave
        // headroom for future stacking by using 400 instead of 250.
        zIndex: 400,
        display: state.visible ? "block" : "none",
        // The SVG is 28x28; the cursor tip is at its top-left corner
        // (matched by the SVG path data), so we don't need a negative
        // margin — translate3d to (x, y) puts the tip exactly there.
        width: 28,
        height: 28,
        willChange: "transform",
      };
    }, [reduced, glideMs, state.x, state.y, state.visible]);

    if (!mounted) return null;

    const node = (
      <div
        aria-hidden="true"
        data-beakerbot-cursor
        className={className}
        style={transitionStyle}
      >
        {/* Inline keyframes for the click ripple. Scoped via the
            wrapper's data-attribute so they don't leak. */}
        <style>{`
          @keyframes beakerbot-cursor-ripple {
            from {
              transform: translate(-50%, -50%) scale(0.4);
              opacity: 0.7;
            }
            to {
              transform: translate(-50%, -50%) scale(2.4);
              opacity: 0;
            }
          }
        `}</style>

        {/* Sky-blue mouse-pointer SVG. Tip is at (2, 2) — top-left of
            the 28x28 viewBox — so the wrapper's translate(x, y) lands
            the tip exactly at the requested screen coords (within
            sub-pixel rounding). 2px stroke + rounded joins match
            BeakerBot.tsx's icon weight per L7. The `pressed` visual
            scales the cursor down slightly to read as a tap-and-hold.
        */}
        <svg
          viewBox="0 0 28 28"
          width={28}
          height={28}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: "#0ea5e9", // text-sky-500
            display: "block",
            transform: state.pressed ? "scale(0.85)" : "scale(1)",
            transformOrigin: "2px 2px",
            transition: reduced ? "none" : "transform 100ms ease-out",
            filter: "drop-shadow(0 1px 2px rgba(14, 165, 233, 0.35))",
          }}
        >
          {/* Mouse-pointer arrow. Tip at (2, 2). The arrow is a simple
              triangle with a tail — matches the BeakerBot icon weight
              (2px, rounded joins) without being a perfect OS replica. */}
          <path
            d="M 2 2 L 2 20 L 7 16 L 10 22 L 13 21 L 10 15 L 16 15 Z"
            fill="white"
          />
        </svg>

        {/* Click ripples — concentric expanding circles. Positioned at
            the cursor TIP (2, 2 in SVG coords), centered via
            translate(-50%, -50%) in the keyframes. Each ripple is a
            separate <span> so multiple rapid clicks render distinct
            ripples that fade independently. */}
        {state.ripples.map((rippleId) => (
          <span
            key={rippleId}
            data-beakerbot-cursor-ripple
            style={{
              position: "absolute",
              left: 2,
              top: 2,
              width: 24,
              height: 24,
              borderRadius: "50%",
              border: "2px solid #0ea5e9",
              transform: "translate(-50%, -50%)",
              animation: `beakerbot-cursor-ripple ${rippleMs}ms ${GLIDE_EASING} forwards`,
              pointerEvents: "none",
            }}
          />
        ))}
      </div>
    );

    return createPortal(node, document.body);
  },
);

export default BeakerBotCursor;
