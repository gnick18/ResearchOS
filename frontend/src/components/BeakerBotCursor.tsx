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
  | { type: "drag"; source: HTMLElement; dest: HTMLElement }
  /**
   * HTML5-drag variant of `drag`. The visual glide-and-press animation
   * is identical to `drag`, but on drop the cursor synthesises a real
   * `DragEvent` carrying a `DataTransfer` payload — required by
   * receivers that listen for `application/x-research-os-image` (the
   * hybrid editor's inline image drop handler) or other dataTransfer
   * MIME types. The `mousedown` → `mouseup` sequence that `drag`
   * dispatches does not populate `e.dataTransfer.getData`, which is why
   * the HE-9 image-drag-in demo was previously visually fake.
   *
   * `payload` is `{ mimeType, data }` — the cursor sets that pair on a
   * fresh `DataTransfer` instance, then fires `dragstart` / `dragover` /
   * `drop` events at the source + dest. Receivers wired to standard
   * HTML5 DnD see a valid drop and process the data.
   */
  | {
      type: "dragFile";
      source: HTMLElement;
      dest: HTMLElement;
      payload: { mimeType: string; data: string };
    }
  /**
   * Run an arbitrary side effect at this position in the action queue.
   * Awaited by `runScript`, so a Promise-returning fn blocks the cursor
   * until it resolves. Used by demos that need to coordinate narration
   * beats with PLAYBACK ordering rather than BUILD ordering (emitting a
   * speech-bubble beat BEFORE the prior click has resolved would
   * narrate a step that hasn't visibly happened yet). The callback
   * fires in script order, AFTER the preceding action's promise has
   * settled, so authors can interleave "did the previous step succeed?
   * emit beat A : emit fallback beat B" decisions. Errors thrown
   * inside fn are caught and logged inside runScript (a buggy callback
   * must not stall the rest of the demo).
   */
  | {
      type: "callback";
      /** Wave 2 Fix 3/9: the callback receives the active runScript
       *  `AbortSignal` (when one was supplied) so it can race its
       *  own waits against cancellation. The signal is forwarded
       *  verbatim — callbacks that don't care about cancellation
       *  can ignore the arg. */
      fn: (signal?: AbortSignal) => void | Promise<void>;
    };

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
  /** Same visual choreography as `dragFromTo`, but on arrival the
   *  cursor dispatches a real HTML5 `DragEvent` (with a populated
   *  `DataTransfer`) at the destination. Required for receivers that
   *  listen for `e.dataTransfer.getData(...)` (the hybrid editor's
   *  inline image drop handler does this for the
   *  `application/x-research-os-image` MIME type). Falls back to the
   *  `mousedown`/`mouseup` path if `DataTransfer` construction fails. */
  dragFile(
    source: HTMLElement,
    dest: HTMLElement,
    payload: { mimeType: string; data: string },
  ): Promise<void>;
  /** Hide the cursor (display: none). */
  hide(): void;
  /** Show the cursor (default visibility). */
  show(): void;
  /** Run a queue of primitives sequentially. Resolves after the last.
   *  Wave 2 Fix 3/9: optional `signal` aborts the script between
   *  actions. callback actions receive the signal so they can chain
   *  it into their own waits. A pending sleep / pause inside an
   *  action is also cancelled by the signal. */
  runScript(actions: readonly CursorAction[], signal?: AbortSignal): Promise<void>;
  /** Snap the cursor to the given coords WITHOUT animation. Used by the
   *  §6.7 HE-8 off-screen entry: the controller calls `snapTo` to place
   *  the cursor outside the viewport before runScript fires, so the
   *  first glide reads as "bringing something in from off screen." */
  snapTo(x: number, y: number): void;
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
  /** §6.7 HE-8 / HE-9 — optional image preview that tracks the cursor
   *  while the step is active. The image renders as a child of the
   *  cursor's wrapper, so the existing translate3d transform carries it
   *  alongside the cursor for free. Pointer-events: none so it doesn't
   *  intercept clicks. */
  heldImage?: {
    src: string;
    width?: number;
    height?: number;
    alt?: string;
  };
}

// ---------------------------------------------------------------------------
// Animation defaults
// ---------------------------------------------------------------------------

// Glide: bumped from 400 -> 850 -> 1000ms across two Grant feedback
// rounds. Watching the cursor traverse needs to be visible without
// becoming tedious.
const DEFAULT_GLIDE_MS = 1000;
const DEFAULT_RIPPLE_MS = 150;
// Type cadence: bumped 95 -> 48ms per character (~2x faster) per Grant
// feedback. Reading at human-typing speed felt awful when watching
// BeakerBot type a full sentence; ~21 chars/sec keeps the "characters
// appearing one at a time" charm without dragging.
const DEFAULT_TYPE_CADENCE_MS = 48;
/** Cubic-bezier matching the brief — "natural feel" easing. */
const GLIDE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * Label offset relative to the cursor wrapper's origin (which lands at
 * the cursor TIP coords thanks to the SVG path having its tip at 2,2).
 * The label is positioned slightly below + right of the tip so it
 * trails the cursor naturally and never visually covers the click
 * target. Falls within the 16-24px band specified by the brief.
 */
const LABEL_OFFSET_X = 18;
const LABEL_OFFSET_Y = 20;

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

/**
 * Wave 2 Fix 3/9: abortable sleep. Resolves when the timer fires OR
 * when the signal aborts (whichever lands first). On abort we resolve
 * (not reject) so callers can simply check `signal.aborted` after the
 * await to decide whether to bail — matches the existing fire-and-
 * forget posture inside runScript.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms <= 0 ? 0 : ms);
    signal.addEventListener("abort", onAbort, { once: true });
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
  /** When true, the next render disables the CSS transition so the
   *  position change is instant. Used by `snapTo` for the §6.7 HE-8
   *  off-screen entry (cursor materialises off-viewport without an
   *  animated "trail" from wherever it was). The flag auto-resets on
   *  the next state change. */
  snap: boolean;
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
      heldImage,
    },
    ref,
  ) {
    // Client-only portal mount. SSR returns null until mounted.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount detection: render nothing on the server, then flip to mounted on client mount so createPortal(document.body) is safe to call.
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
      snap: false,
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
    // ---------------------------------------------------------------------
    // Primitive: SnapTo (no animation) — §6.7 HE-8 off-screen entry
    // ---------------------------------------------------------------------
    const snapTo = useCallback((x: number, y: number): void => {
      // Flip the `snap` flag so the next render's `transition` resolves
      // to `none`. We schedule a microtask to flip it back so subsequent
      // `glideTo` calls regain the smooth animation.
      setState((prev) => ({ ...prev, x, y, snap: true }));
      // Re-enable transitions on the next frame. A simple
      // `requestAnimationFrame` is cheaper than another setState round
      // trip; the next animated change will land with the transition
      // back in place.
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          setState((prev) => (prev.snap ? { ...prev, snap: false } : prev));
        });
      }
    }, []);

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
          // The InputLockOverlay's capture-phase window 'click' listener
          // would otherwise stopPropagation our own click and React's
          // onClick handler never sees it (Grant 2026-05-21: §6.4 New
          // Category and Create Empty were animating but not triggering).
          // Set a window flag for the duration of `el.click()` so the
          // overlay can short-circuit. We use a flag rather than a marker
          // on a self-dispatched MouseEvent because `el.click()` invokes
          // the element's full activation behavior (which dispatchEvent
          // does not), and several jsdom-attached `onclick`s in tests
          // depend on that path.
          if (typeof window !== "undefined") {
            (window as unknown as { __beakerBotCursorClicking: boolean }).__beakerBotCursorClicking = true;
          }
          try {
            el.click();
          } finally {
            if (typeof window !== "undefined") {
              (window as unknown as { __beakerBotCursorClicking: boolean }).__beakerBotCursorClicking = false;
            }
          }
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
          // Wave 2 Fix 4/9: re-read the input value on every tick so
          // user keystrokes mid-typewriter compound with BeakerBot's
          // typing instead of getting overwritten. `prevTypedLength`
          // tracks how many chars of the demo `text` we've already
          // committed; the next char appends to whatever value the
          // input currently holds (user input + prior demo chars).
          // Previously a one-shot `startingValue = el.value` capture
          // meant every tick stomped the user's intervening edits
          // back to the snapshot.
          let prevTypedLength = 0;
          for (let i = 0; i < text.length; i++) {
            const currentValue = el.value;
            const nextChar = text.charAt(prevTypedLength);
            setNativeInputValue(el, currentValue + nextChar);
            prevTypedLength += 1;
            // Reduced motion: still respect cadence so the test's
            // intent (cursor types into the input) is observable.
            // The brief allows this — "could be sped up; out of scope."
            await sleep(cadence);
          }
          return;
        }

        // Wrapper-with-input fallback. Some targets (e.g. the §6.7 hybrid
        // editor's `[data-tour-target="hybrid-editor-textarea"]` wrapper
        // div) host a real native <textarea> or <input> as a descendant.
        // The wrapper may need a click to MOUNT that descendant (the
        // hybrid editor lazily renders its textarea only when an edit
        // block is active). Try to find / mount it; if successful, type
        // through the React-safe setter so the app's onChange handlers
        // fire and the value actually lands. Without this, the prior
        // `el.textContent = ...` fallback was just visual — React's
        // next render clobbered the mutation and the demo's bold /
        // italic / underline / heading typing never committed to the
        // editor's model.
        const findInnerInput = (): HTMLInputElement | HTMLTextAreaElement | null => {
          const inner = el.querySelector("textarea, input[type='text'], input:not([type])");
          if (inner instanceof HTMLTextAreaElement || inner instanceof HTMLInputElement) {
            return inner;
          }
          return null;
        };
        let innerInput = findInnerInput();
        if (!innerInput) {
          // Click to mount the descendant input. The hybrid editor's
          // wrapper click handler creates a new edit block on click,
          // which renders the inline textarea on the next React commit.
          try {
            el.click();
          } catch {
            // No-op.
          }
          // Wait a microtask + a small RAF-equivalent for React to
          // commit the new textarea. 60ms is conservative — long enough
          // for a typical commit, short enough that the user sees the
          // cursor click and type-start as one continuous beat.
          await sleep(60);
          innerInput = findInnerInput();
        }

        if (innerInput) {
          try {
            innerInput.focus();
          } catch {
            // No-op.
          }
          // Wave 2 Fix 4/9: same compound-with-user-keystrokes
          // contract as the native-input branch above.
          let prevTypedLength = 0;
          for (let i = 0; i < text.length; i++) {
            const currentValue = innerInput.value;
            const nextChar = text.charAt(prevTypedLength);
            setNativeInputValue(innerInput, currentValue + nextChar);
            prevTypedLength += 1;
            await sleep(cadence);
          }
          return;
        }

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
    // Primitive: DragFile (HTML5 drag with DataTransfer payload)
    //
    // Hybrid editor manager R1 fix-pass (Onboarding v4 §6.7 HE-9). The
    // hybrid editor's inline-image drop handler listens for
    // `application/x-research-os-image` data on the native `DragEvent`
    // — the plain `dragFromTo` path above fires `mousedown` /
    // `mousemove` / `mouseup` but never populates `e.dataTransfer`, so
    // the receiver gets nothing and the cursor demo lands no markdown
    // snippet. `dragFile` mirrors the glide/press choreography, then on
    // arrival dispatches `dragstart` → `dragenter` → `dragover` → `drop`
    // events with a synthesised `DataTransfer` carrying the requested
    // MIME-typed payload. Receivers wired to standard HTML5 DnD see a
    // valid drop and process the data.
    //
    // Fallback: when `DataTransfer` can't be constructed (rare; some
    // older test runtimes), the cursor still completes the visual glide
    // and dispatches the `mousedown`/`mouseup` pair so any receivers
    // listening on raw mouse events still see the drop visually.
    // ---------------------------------------------------------------------
    const dragFile = useCallback(
      async (
        source: HTMLElement,
        dest: HTMLElement,
        payload: { mimeType: string; data: string },
      ): Promise<void> => {
        const src = elementCenter(source);
        const dst = elementCenter(dest);

        // 1. Glide to source.
        await glideTo(src.x, src.y);

        // 2. Pressed visual on.
        setState((prev) => ({ ...prev, pressed: true }));

        // 3. Build a DataTransfer carrying the payload. Reused across
        // every drag-stage event so handlers reading `getData` on
        // dragover OR drop both see it.
        let dt: DataTransfer | null = null;
        try {
          dt = new DataTransfer();
          dt.setData(payload.mimeType, payload.data);
        } catch {
          dt = null;
        }

        const dispatchDrag = (
          target: EventTarget,
          eventName: string,
          x: number,
          y: number,
        ): void => {
          try {
            // DragEvent is the spec'd type; jsdom supports the constructor
            // when DataTransfer is also available. Falls back to a generic
            // Event with the dataTransfer property bolted on if the
            // DragEvent constructor isn't available.
            let evt: Event;
            try {
              evt = new DragEvent(eventName, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                dataTransfer: dt,
              });
            } catch {
              evt = new Event(eventName, { bubbles: true, cancelable: true });
              try {
                Object.defineProperty(evt, "dataTransfer", { value: dt });
                Object.defineProperty(evt, "clientX", { value: x });
                Object.defineProperty(evt, "clientY", { value: y });
              } catch {
                // No-op.
              }
            }
            target.dispatchEvent(evt);
          } catch {
            // No-op.
          }
        };

        // 4. Fire dragstart at source, dragenter+dragover at dest as the
        // cursor approaches, then drop at dest on arrival.
        dispatchDrag(source, "dragstart", src.x, src.y);
        if (!reducedRef.current) {
          // Mid-drag interaction so libraries that gate on dragover see motion.
          dispatchDrag(
            dest,
            "dragenter",
            (src.x + dst.x) / 2,
            (src.y + dst.y) / 2,
          );
          dispatchDrag(
            dest,
            "dragover",
            (src.x + dst.x) / 2,
            (src.y + dst.y) / 2,
          );
        }
        await glideTo(dst.x, dst.y);

        // 5. Final dragover + drop at the destination.
        dispatchDrag(dest, "dragover", dst.x, dst.y);
        dispatchDrag(dest, "drop", dst.x, dst.y);
        // 6. Release: dragend at source.
        dispatchDrag(source, "dragend", dst.x, dst.y);

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
      async (
        actions: readonly CursorAction[],
        signal?: AbortSignal,
      ): Promise<void> => {
        for (const action of actions) {
          // Wave 2 Fix 3/9: short-circuit between actions when the
          // controller has aborted. We don't try to mid-cancel an
          // in-flight glide/click/type — those resolve in ~hundreds
          // of ms — but we DO stop the queue at the next boundary.
          // Pauses + the new abortable sleep also resolve early when
          // aborted, so a stuck script can release in under a frame
          // of wall time when cancellation lands.
          if (signal?.aborted) return;
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
            case "dragFile":
              await dragFile(action.source, action.dest, action.payload);
              break;
            case "callback":
              // Side-effect step (narration beat, DOM probe, etc).
              // Awaited so the next cursor action runs AFTER the
              // callback's promise resolves. Wrapped in try/catch so a
              // buggy callback can't kill the rest of the demo,
              // matching the script-runner's overall "errors are
              // swallowed + logged" posture (TourController already
              // wraps runScript in another try/catch one level up).
              try {
                await action.fn(signal);
              } catch (err) {
                console.warn(
                  "[BeakerBotCursor] callback action threw:",
                  err,
                );
              }
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
      [glideTo, clickAt, typeInto, dragFromTo, dragFile],
    );

    // Expose the imperative API.
    useImperativeHandle(
      ref,
      () => ({
        glideTo,
        clickAt,
        typeInto,
        dragFromTo,
        dragFile,
        hide,
        show,
        runScript,
        snapTo,
      }),
      [glideTo, clickAt, typeInto, dragFromTo, dragFile, hide, show, runScript, snapTo],
    );

    // ---------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------
    const transitionStyle = useMemo<React.CSSProperties>(() => {
      // The transform is the only animated property; reduced motion
      // turns it off entirely so position updates are instant. The
      // `snap` flag (set by snapTo for HE-8 off-screen entry) also
      // disables the transition for a single render.
      const transition = reduced || state.snap
        ? "none"
        : `transform ${glideMs}ms ${GLIDE_EASING}`;
      return {
        position: "fixed",
        top: 0,
        left: 0,
        // Round to integer pixels so the GPU rasterizer doesn't sample
        // the label glyphs at sub-pixel positions during glide — that
        // sub-pixel sampling is what made the BeakerBot label read as
        // visibly blurry vs the rest of the page (Grant 2026-05-21).
        transform: `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0)`,
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
    }, [reduced, glideMs, state.x, state.y, state.visible, state.snap]);

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

        {/* §6.7 HE-8 / HE-9 — held-image preview. The cursor "holds" a
            thumbnail while gliding so the user reads it as drag-from-
            off-screen / drag-into-editor. Positioned slightly above
            and to the right of the cursor tip; pointer-events none. */}
        {heldImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- demo asset is sized as a small thumb; next/image would over-engineer.
          <img
            data-beakerbot-cursor-held-image
            src={heldImage.src}
            alt={heldImage.alt ?? "BeakerBot demo image"}
            width={heldImage.width ?? 48}
            height={heldImage.height ?? 48}
            style={{
              position: "absolute",
              // Offset above-right of the cursor tip so it reads as
              // something the cursor is "carrying" rather than something
              // it's about to click.
              left: 14,
              top: -10,
              width: heldImage.width ?? 48,
              height: heldImage.height ?? 48,
              objectFit: "cover",
              borderRadius: 6,
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.25)",
              border: "2px solid white",
              pointerEvents: "none",
              userSelect: "none",
            }}
          />
        ) : null}

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

        {/* Reassurance label. A user seeing a foreign cursor glide
            across their screen can reasonably worry about a remote
            takeover or virus; the label names the source ("BeakerBot")
            so it reads as a friendly product animation, not a live
            operator. Positioned ~20px below + ~18px right of the
            cursor TIP (which sits at SVG coords 2, 2). The label is a
            child of the same wrapper as the cursor SVG, so it inherits
            the wrapper's translate3d glide and the wrapper's
            display:none when hide() is called, so no separate
            visibility wiring is needed. */}
        <span
          data-beakerbot-cursor-label
          data-label-offset-x={LABEL_OFFSET_X}
          data-label-offset-y={LABEL_OFFSET_Y}
          style={{
            position: "absolute",
            left: LABEL_OFFSET_X,
            top: LABEL_OFFSET_Y,
            // The label is wider than the 28x28 cursor wrapper; allow
            // it to overflow without being clipped or wrapped.
            whiteSpace: "nowrap",
            backgroundColor: "#0ea5e9", // bg-sky-500, pairs with the cursor stroke
            color: "white",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
            padding: "3px 8px", // px-2 py-0.5 equivalent
            borderRadius: 9999, // rounded-full
            boxShadow:
              "0 1px 3px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.12)",
            pointerEvents: "none",
            // Match the cursor SVG's fade behavior: instant in jsdom,
            // soft fade-in for real browsers (the wrapper's display
            // toggle handles hide/show; this transition just softens
            // the initial reveal alongside the cursor).
            transition: reduced ? "none" : "opacity 200ms ease-out",
            userSelect: "none",
            // Text crispness inside the GPU-composited wrapper. The
            // translate3d transform on the parent puts this label on a
            // GPU layer; without these hints the rasterizer samples
            // glyph edges at sub-pixel positions and the text reads as
            // blurry next to the rest of the page (Grant 2026-05-21).
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
            textRendering: "geometricPrecision",
          }}
        >
          BeakerBot
        </span>
      </div>
    );

    return createPortal(node, document.body);
  },
);

export default BeakerBotCursor;
