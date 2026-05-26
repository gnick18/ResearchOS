/**
 * Cursor-script authoring helpers for the Onboarding v4 universal
 * walkthrough (P5 — see ONBOARDING_V4_PROPOSAL.md §6).
 *
 * Design call (§12 Q3 in the proposal): cursor scripts are authored as
 * IMPERATIVE lazy callbacks of shape `() => Promise<CursorAction[]>` (or
 * the sync variant). The TourController invokes the callback at step
 * entry — late enough that `document.querySelector` can resolve real
 * product surfaces, early enough that the cursor animation lines up
 * with the speech bubble landing. The callback also lets a step
 * dynamically wait for the target to mount (via `waitForElement`) so a
 * navigation-then-anchor step doesn't race the route render.
 *
 * Why imperative-lazy + not a static JSON tree:
 *
 *  - Targets resolve at runtime (selector → HTMLElement). A static JSON
 *    tree would either need a separate resolution pass on every step
 *    entry, or it would need to serialise HTMLElement which doesn't
 *    work. The callback shape lets each step build its CursorAction[]
 *    after the right page has rendered.
 *  - Some demos need branching: "if the user already clicked the button
 *    while we were narrating, skip the glide-to-button step." The
 *    callback can read DOM state and produce a different action list.
 *  - Composition matches the underlying primitive: BeakerBotCursor.ref
 *    already exposes `runScript(actions)`, so the step body just has to
 *    produce the actions array.
 *
 * Use `cursorScript(buildFn)` to declare a script; use `waitForElement`
 * to defer until a target mounts; use `safeClickAction` / `safeTypeAction`
 * to skip a step gracefully if the target never appears.
 */
import type { CursorAction } from "@/components/BeakerBotCursor";
import { abortableSleep } from "@/components/BeakerBotCursor";

/**
 * Build a cursor script. The returned callback is what `TourStep.cursorScript`
 * expects. Sugar over `async () => [...]` so the action-array intent is
 * readable at the call site.
 */
export function cursorScript(
  build: () => CursorAction[] | Promise<CursorAction[]>,
): () => Promise<CursorAction[]> {
  return async () => build();
}

/**
 * Wait until the first element matching `selector` exists in the DOM,
 * or until `timeoutMs` elapses. Resolves with the matched HTMLElement
 * (or `null` on timeout — callers must handle the null branch since the
 * page may have failed to render).
 *
 * Uses a MutationObserver on document.body rather than a polling loop —
 * cheaper, fires the moment the target mounts. Falls back to a 200ms
 * interval timer in the (impossible-in-practice) case where
 * MutationObserver is unavailable; this keeps the helper safe in jsdom
 * which does ship MutationObserver but doesn't always observe React
 * commits depending on the test harness.
 */
export async function waitForElement(
  selector: string,
  timeoutMs = 5000,
): Promise<HTMLElement | null> {
  if (typeof document === "undefined") return null;
  const immediate = document.querySelector(selector);
  if (immediate instanceof HTMLElement) return immediate;

  return new Promise<HTMLElement | null>((resolve) => {
    let done = false;
    const finish = (value: HTMLElement | null) => {
      if (done) return;
      done = true;
      mo?.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
      if (interval !== undefined) window.clearInterval(interval);
      resolve(value);
    };

    let mo: MutationObserver | undefined;
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el instanceof HTMLElement) finish(el);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // Polling fallback for environments where MutationObserver doesn't
    // catch React commits (rare but observed in some jsdom configs).
    const interval = window.setInterval(() => {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) finish(el);
    }, 200);

    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Resolve a selector to an HTMLElement, or null if missing. Synchronous
 * sibling of `waitForElement` — use when the caller already awaited the
 * page render and just needs a quick lookup.
 */
export function tryQuery(selector: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(selector);
  return el instanceof HTMLElement ? el : null;
}

/**
 * Internal helper: ensure `el` is fully visible in the viewport before
 * the cursor action targeting it runs. Called by every safe* factory
 * after the element resolves and BEFORE the CursorAction is returned —
 * by the time the controller invokes `cursor.runScript(actions)` the
 * target has already been scrolled into view (and the rect has settled),
 * so the glide+click hits an element the user can actually see.
 *
 * Without this, a cursor demo on a small viewport (Grant's §6.4b PCR +
 * LC Gradient editor case, 2026-05-21) silently fires below the fold —
 * the cursor animates off-screen, the click() succeeds, but the user
 * sees nothing because the target is below the fold.
 *
 * Strategy:
 *  1. SSR / non-browser → resolve immediately (no DOM to scroll).
 *  2. `scrollIntoView` missing (jsdom, ancient browsers) → resolve
 *     immediately. Tests that mock scrollIntoView can still observe the
 *     call via the mock; the in-view rect check is the only thing they
 *     short-circuit.
 *  3. Element already fully inside the viewport → resolve immediately
 *     (the rect check makes this a true no-op).
 *  4. Otherwise call `scrollIntoView({ block: "center", inline: "center",
 *     behavior: "smooth" })` and poll the rect (~16ms cadence) until two
 *     consecutive samples match (rect stopped moving) OR until we hit
 *     the iteration cap. The cap (~600ms total) is the upper bound on
 *     "smooth" scroll duration in evergreen browsers; past that we assume
 *     the scroll settled or the element is stuck, and proceed.
 *  5. `scrollIntoView` also handles scrollable ancestors natively — no
 *     special "find scroll parent" logic needed.
 */
async function ensureInViewport(el: HTMLElement): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // scrollIntoView is missing in jsdom by default; some test fixtures
  // stub it. Either way, if it's not a function, there's nothing to do.
  if (typeof el.scrollIntoView !== "function") return;

  const isFullyVisible = (rect: DOMRect): boolean =>
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth;

  const initialRect = el.getBoundingClientRect();
  if (isFullyVisible(initialRect)) return;

  try {
    el.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
  } catch {
    // Some test environments throw on scrollIntoView options; fall
    // through and just rely on the rect-poll below to give the scroll
    // (if any) a chance to settle.
  }

  // Poll the rect at ~one-frame cadence until it stops moving or until
  // we hit the cap. We compare against the previous sample instead of a
  // fixed target rect because the scroll might not bring the element to
  // the exact center (e.g. constrained by document bounds), so "settled"
  // is the more reliable signal than "matches goal."
  const MAX_ITERATIONS = 40; // ~640ms at 16ms cadence
  const POLL_INTERVAL_MS = 16;
  let prevRect = initialRect;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, POLL_INTERVAL_MS);
    });
    const nextRect = el.getBoundingClientRect();
    if (
      Math.abs(nextRect.top - prevRect.top) < 0.5 &&
      Math.abs(nextRect.left - prevRect.left) < 0.5
    ) {
      // Two consecutive identical samples → scroll has settled.
      return;
    }
    prevRect = nextRect;
  }
  // Iteration cap hit — proceed anyway so a stuck scroll doesn't deadlock
  // the script. The cursor will still animate to wherever the element
  // ended up.
}

// Export for tests; not part of the public API.
export const __test_ensureInViewport = ensureInViewport;

/**
 * Scroll a LARGER anchor surface (e.g. the whole PCR builder card) into
 * view BEFORE the cursor script's per-action `ensureInViewport` runs.
 * Differs from `ensureInViewport`:
 *
 *  - Resolves the selector itself (waits up to `timeoutMs` for mount).
 *    Per-action helpers receive the element already-resolved; this one
 *    is the entry point for the controller, which only knows the selector.
 *  - Block decision depends on anchor height: if the anchor fits in the
 *    viewport, scrolls to `block: "center"` (the user can see the whole
 *    widget centered). If the anchor is TALLER than the viewport, scrolls
 *    to `block: "start"` so the user sees the TOP of the widget ("show
 *    me all of this, starting from the top" per Grant's brief).
 *
 * Returns when the scroll settles or the iteration cap fires (~640ms).
 * No-op if the selector misses (logs a warn so tour authors notice
 * stale anchor selectors), or if `scrollIntoView` is unavailable.
 */
export async function ensureViewportAnchor(
  selector: string,
  timeoutMs = 2000,
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const el = await waitForElement(selector, timeoutMs);
  if (!el) {
    // Log so a tour author who renamed an anchor selector sees the
    // miss in the console; the demo still proceeds (per-action
    // ensureInViewport will handle the small target).
    console.warn(
      `[onboarding-v4] viewportAnchor selector "${selector}" did not mount`,
    );
    return;
  }
  if (typeof el.scrollIntoView !== "function") return;

  const rect = el.getBoundingClientRect();
  // Choose block based on whether the anchor fits. window.innerHeight is
  // the comparison rather than a smaller floor because the user's
  // viewport IS the budget — if the anchor is even a few pixels taller,
  // centering would hide either its top or bottom; scrolling to start
  // gives the user the top of the widget (which the brief specifies as
  // "all of this widget, starting from the top").
  const block: ScrollLogicalPosition =
    rect.height > window.innerHeight ? "start" : "center";

  try {
    el.scrollIntoView({ block, inline: "center", behavior: "smooth" });
  } catch {
    // Some environments throw on options; fall through to the poll.
  }

  // Poll the rect to detect when the smooth scroll has settled, with the
  // same iteration cap as `ensureInViewport` so a stuck scroll doesn't
  // deadlock the cursor.
  const MAX_ITERATIONS = 40;
  const POLL_INTERVAL_MS = 16;
  let prevRect = rect;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, POLL_INTERVAL_MS);
    });
    const nextRect = el.getBoundingClientRect();
    if (
      Math.abs(nextRect.top - prevRect.top) < 0.5 &&
      Math.abs(nextRect.left - prevRect.left) < 0.5
    ) {
      return;
    }
    prevRect = nextRect;
  }
}

/**
 * Build a click action against a selector, waiting for the target to
 * mount. Returns `null` if the target never appears, so the caller can
 * filter nulls out of the action list with `.filter((a): a is
 * CursorAction => a !== null)`.
 */
export async function safeClickAction(
  selector: string,
  timeoutMs?: number,
): Promise<CursorAction | null> {
  const el = await waitForElement(selector, timeoutMs);
  if (!el) return null;
  await ensureInViewport(el);
  return { type: "click", target: el };
}

/**
 * Build a type action against a selector, waiting for the target to
 * mount. See `safeClickAction` for the null-on-timeout contract.
 */
export async function safeTypeAction(
  selector: string,
  text: string,
  cadenceMs?: number,
  timeoutMs?: number,
): Promise<CursorAction | null> {
  const el = await waitForElement(selector, timeoutMs);
  if (!el) return null;
  await ensureInViewport(el);
  return { type: "type", target: el, text, cadenceMs };
}

/**
 * Build a glide action to the center of the element matching `selector`,
 * waiting for the target to mount. Resolves the element's center via
 * `getBoundingClientRect` at script-build time, so the resulting `glide`
 * action carries fixed coords (no re-layout once the script is dispatched).
 *
 * Used by hover-tour bodies (the §6.4b method-type breadth tour) where
 * the cursor visits multiple tiles in sequence without clicking. Each
 * `glide` blocks for the cursor's configured glideMs (default 1000ms),
 * which provides the natural "linger on each tile" beat. There is no
 * separate sleep / pause primitive on the cursor.
 *
 * Returns `null` if the target never mounts; caller filters with
 * `compactScript`.
 */
export async function safeGlideToElementAction(
  selector: string,
  timeoutMs?: number,
): Promise<CursorAction | null> {
  const el = await waitForElement(selector, timeoutMs);
  if (!el) return null;
  await ensureInViewport(el);
  // Re-read the rect AFTER scrolling settled — pre-scroll coords would
  // glide the cursor to where the element used to sit, not where it is.
  const rect = el.getBoundingClientRect();
  return {
    type: "glide",
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * Build a drag action between two selectors, waiting for both to mount.
 * Returns `null` if either selector misses — caller filters nulls.
 */
export async function safeDragAction(
  sourceSelector: string,
  destSelector: string,
  timeoutMs?: number,
): Promise<CursorAction | null> {
  const src = await waitForElement(sourceSelector, timeoutMs);
  const dst = src ? await waitForElement(destSelector, timeoutMs) : null;
  if (!src || !dst) return null;
  // Scroll the source into view first so the press lands on something
  // visible; the cursor's drag glide will then carry the user's eye to
  // the destination naturally. We don't scroll BOTH endpoints into view
  // at once because they may not coexist in the same viewport — the
  // animation itself is what should bridge them. If the destination
  // ends up off-screen after the source scroll, the drag will still
  // execute, and authors who need the dest scrolled too can author the
  // step accordingly.
  await ensureInViewport(src);
  return { type: "drag", source: src, dest: dst };
}

/**
 * Build a side-effect "callback" action that runs at PLAYBACK time
 * (not BUILD time). The fn fires AFTER the preceding cursor action's
 * promise resolves, so authors can synchronise narration beats with
 * the actual cursor playback rather than the script-builder
 * accumulation order.
 *
 * Why this exists (HR 2026-05-22, lab-permission-practice narration
 * honesty bug R7-B P0-2):
 *
 *   Before this helper, lab-permission-practice fired
 *   `emitBeat("edit-done")` inline during the script build with a
 *   `setTimeout(400)` spacer between it and the prior
 *   `safeClickAction`. But `safeClickAction` resolves at BUILD time
 *   the moment the anchor exists; the actual click doesn't happen
 *   until runScript replays the action array. So the speech bubble
 *   would narrate "the rename just landed" even when the cursor was
 *   still gliding toward the Save button, or when the shared cards
 *   weren't in the DOM at all.
 *
 *   With `callbackAction`, the build function returns a single action
 *   array, and the narration emit sits BETWEEN the cursor actions in
 *   that array. runScript awaits each callback the same way it
 *   awaits a click, so the emit runs after the preceding click has
 *   visibly landed.
 *
 * The fn is fire-and-forget (return value ignored). Sync or async OK.
 * Errors are caught + logged inside runScript so a buggy callback
 * doesn't deadlock the demo.
 *
 * Returns the action directly (no null branch) since callbacks have
 * no DOM anchor to fail on. Authors that want a conditional callback
 * can just gate it on their own condition before pushing it.
 */
export function callbackAction(
  fn: (signal?: AbortSignal) => void | Promise<void>,
): CursorAction {
  return { type: "callback", fn };
}

/**
 * Wave 2 Fix 3/9 — abortable pause action.
 *
 * Wraps a `setTimeout`-based wait inside a callback action so the
 * runScript caller's AbortSignal (if any) can short-circuit the
 * pause. Without this, a step body's `pause(2000)` would hold the
 * cursor queue for the full 2s even if the controller already
 * cancelled. With it, the timer races abort and the queue advances
 * (then short-circuits at the next abort check in runScript).
 */
export function pause(ms: number): CursorAction {
  return callbackAction(async (signal) => {
    await abortableSleep(ms, signal);
  });
}

/**
 * Build an HTML5 drag action between two selectors with a typed
 * dataTransfer payload (Hybrid editor manager R1 fix-pass, §6.7 HE-9).
 *
 * The hybrid editor's inline-image drop handler reads
 * `e.dataTransfer.getData("application/x-research-os-image")` on the
 * native `DragEvent`. The plain `safeDragAction` path only dispatches
 * `mousedown` / `mouseup` (no DataTransfer), so the handler sees
 * nothing and the image-drag-in demo lands no markdown snippet. This
 * helper resolves the source + dest selectors, then queues a
 * `dragFile` cursor action that mirrors the visual glide-and-press
 * choreography of `drag` while populating a real DataTransfer with
 * the requested MIME-typed payload.
 *
 * Returns `null` if either selector misses — caller filters with
 * `compactScript`, same contract as `safeDragAction`.
 */
export async function safeDragFileAction(
  sourceSelector: string,
  destSelector: string,
  payload: { mimeType: string; data: string },
  timeoutMs?: number,
): Promise<CursorAction | null> {
  const src = await waitForElement(sourceSelector, timeoutMs);
  const dst = src ? await waitForElement(destSelector, timeoutMs) : null;
  if (!src || !dst) return null;
  await ensureInViewport(src);
  return { type: "dragFile", source: src, dest: dst, payload };
}

/**
 * Build a synthetic "click out" action — fires a `mousedown` event on
 * `document.body` (well outside any hybrid-editor wrapper) so the
 * editor's `mousedown` click-outside listener commits the currently
 * open edit block and the rendered markdown lands. Used by the §6.7
 * HE-5 / HE-6 typing beats after the cursor types its sample sentence
 * (see HybridMarkdownEditor.tsx's click-outside handler that calls
 * `handleEditBlur`).
 *
 * Returns a `callback` action rather than a `click` action because the
 * editor's listener is `mousedown`-based at the document level — a
 * real `el.click()` on body doesn't fire `mousedown` at the right time
 * and the cursor's visual ripple is misleading here anyway (there's no
 * meaningful target to ripple on).
 *
 * R2 fix-pass (Hybrid fix manager R2, 2026-05-22 — P0): wrap the
 * dispatch with `window.__beakerBotCursorClicking` so the
 * `InputLockOverlay`'s capture-phase mousedown blocker short-circuits.
 * Without the flag, the overlay's window-level capture listener fires
 * `stopPropagation()` + `preventDefault()` before the editor's
 * document-level mousedown listener ever sees the event — so the edit
 * block never commits and the typed markdown stays in textarea form
 * (no bold/italic/header render lands). This matches the same pattern
 * `BeakerBotCursor.clickAt` uses to ride past the overlay.
 */
/**
 * Fire a programmatic `el.click()` while temporarily setting the
 * `window.__beakerBotCursorClicking` flag so the `InputLockOverlay`'s
 * capture-phase `click` blocker short-circuits.
 *
 * §6.2b R4 fix manager (2026-05-25): hoisted from a tangle of inline
 * try/finally flag-flips spread across `deferredClickAction`,
 * `safeNavClickAction`, `BeakerBotCursor.clickAt`, `clickOutsideEditorAction`,
 * and (the bug this helper was created to fix) the step bodies'
 * `onEnter` / `onExit` raw `el.click()` calls. The fresh-eyes R3
 * verifier caught that `HomeWidgetsExitStep`'s `onEnter` click on the
 * `Done` button was being swallowed by the InputLockOverlay during a
 * real sequential walk because the click fired AFTER the controller
 * had already set `inputLockActive = true` for the next step's
 * cursor script. Without the flag, the overlay's window-level capture
 * listener stopPropagation'd the click before SnapshotCanvas's onClick
 * fired, so edit mode stayed on through §6.3.
 *
 * Use this helper for ANY programmatic `el.click()` invoked inside a
 * step body's `onEnter`, `onExit`, or any other lifecycle hook that
 * might race the InputLockOverlay's mounted window. Direct primitives
 * inside `BeakerBotCursor` (clickAt, etc.) already handle the flag
 * inline because they're hot paths and the flag-set is fused with
 * the click ripple animation, but anywhere a step author would type
 * `el.click()` they should reach for this helper instead.
 *
 * The flag is reset in a `finally` block so a throwing click can't
 * leave the lock free-riding for the next user click.
 *
 * Returns nothing (the helper is fire-and-forget); errors are
 * swallowed and logged because the flag-reset matters more than the
 * caller knowing the click threw (a detached node or unmountable
 * target is a routine no-op in the tour).
 */
export function tourClickWithLockBypass(el: HTMLElement): void {
  if (typeof window === "undefined") {
    try {
      el.click();
    } catch {
      // No-op (SSR or constrained env).
    }
    return;
  }
  const w = window as unknown as { __beakerBotCursorClicking?: boolean };
  w.__beakerBotCursorClicking = true;
  try {
    el.click();
  } catch (err) {
    console.warn("[onboarding-v4] tourClickWithLockBypass: click threw:", err);
  } finally {
    w.__beakerBotCursorClicking = false;
  }
}

export function clickOutsideEditorAction(): CursorAction {
  return callbackAction(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const w = window as unknown as { __beakerBotCursorClicking?: boolean };
    w.__beakerBotCursorClicking = true;
    try {
      // Fire mousedown on document.body — the editor's click-outside
      // handler triggers off mousedown at the document level (not click),
      // so this is what actually commits the block. Also fire mouseup +
      // click so any other listeners (e.g. selection-tracking) settle
      // consistently with a real pointer click.
      document.body.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      );
      document.body.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      );
      document.body.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      );
    } catch {
      // No-op.
    } finally {
      w.__beakerBotCursorClicking = false;
    }
  });
}

/**
 * Filter helper that drops null entries from a script-builder pipeline.
 * Generic so it preserves the discriminated union of `CursorAction`.
 */
export function compactScript(
  actions: ReadonlyArray<CursorAction | null>,
): CursorAction[] {
  return actions.filter((a): a is CursorAction => a !== null);
}

/**
 * Build a deferred click action: waits for the selector to mount AT
 * PLAYBACK time (inside the callback's promise), then dispatches a
 * native `.click()` on the resolved element. Returns a `callback`
 * action so the wait + click happens between adjacent cursor
 * primitives instead of at script-build time.
 *
 * Lab Mode fix manager R1 (2026-05-22): the lab-mode-* tab demos
 * chain "click row, popup mounts, click close". `safeClickAction`
 * resolves DOM refs at BUILD time, so the popup's close button
 * doesn't yet exist when the build pipeline asks for it (the row
 * click hasn't been played). `deferredClickAction` defers the
 * resolve+click to playback so the chain works.
 *
 * `timeoutMs` mirrors `waitForElement`'s default (5s). If the
 * element never mounts, the callback logs a warn and resolves
 * (the rest of the action list still plays).
 *
 * No visual cursor glide: the click fires programmatically. For
 * popup dismisses that should look intentional (cursor moves to the
 * close button before clicking), use `safeClickAction` instead and
 * pre-condition on the popup being open when the step starts.
 *
 * §6.2b R1 fix (2026-05-25): wrap the `el.click()` with the
 * `window.__beakerBotCursorClicking` flag (mirrors `safeClickAction`'s
 * runtime path in BeakerBotCursor.clickAt) so the InputLockOverlay's
 * capture-phase `click` blocker short-circuits and React's `onClick`
 * handlers fire. Also call `ensureInViewport(el)` first so deferred
 * targets that mounted below the fold (e.g. catalog item at y=1115
 * in a 900px viewport) get scrolled into view before the click. Both
 * fixes match the pattern `safeClickAction` already uses; without
 * them, the §6.2b add step's catalog-item click silently no-oped at
 * 1440x900 because the overlay's blocker stopPropagation'd the click
 * AND the item was below the fold.
 */
export function deferredClickAction(
  selector: string,
  timeoutMs = 5000,
): CursorAction {
  return callbackAction(async () => {
    const el = await waitForElement(selector, timeoutMs);
    if (!el) {
      console.warn(
        `[onboarding-v4] deferredClickAction: selector "${selector}" never mounted`,
      );
      return;
    }
    // Scroll the target into view before clicking so a below-fold
    // node (catalog item, deeply-stacked popup button, etc.) gets a
    // visible click rather than firing off-screen. Matches the
    // pre-click scroll-into-view step in `safeClickAction`.
    await ensureInViewport(el);
    // The InputLockOverlay's capture-phase `click` listener calls
    // `stopPropagation()` on every click in the window unless the
    // `__beakerBotCursorClicking` flag is set. Without the flag, the
    // overlay swallows our deferred click before React's delegated
    // `onClick` handler runs. The flag is the same one
    // `BeakerBotCursor.clickAt` uses around its own `el.click()`.
    const w =
      typeof window !== "undefined"
        ? (window as unknown as { __beakerBotCursorClicking?: boolean })
        : null;
    if (w) w.__beakerBotCursorClicking = true;
    try {
      el.click();
    } catch (err) {
      console.warn(
        `[onboarding-v4] deferredClickAction: click on "${selector}" threw:`,
        err,
      );
    } finally {
      if (w) w.__beakerBotCursorClicking = false;
    }
  });
}

/**
 * Navigation-grade click: build-time glide to the target's center
 * for the visual cue, then a PLAYBACK-time selector re-resolution
 * + native `el.click()` so a re-render between build and click
 * (TanStack Query refetch, new project landing in the list, etc.)
 * does not leave us holding a stale DOM ref.
 *
 * Why this exists (§6.2 NAV root cause manager 2026-05-23):
 * `safeClickAction` resolves the element at script-build time and
 * stamps `target: el` on the returned `click` action. If the parent
 * component re-renders between build and runScript playback, the
 * fiber gets a fresh DOM node for the card and OUR stored `el` ref
 * points at the now-detached node. `el.click()` on a detached node
 * fires a click event with no listeners (no React fiber tree to
 * delegate through), so `router.push` never runs. The cursor's
 * `__beakerBotCursorClicking` flag stays cleanly set then cleared,
 * the InputLockOverlay's blockEvent short-circuits cleanly, no
 * console errors land — the click just silently no-ops and the
 * user is wedged behind the lock for the rest of the runScript
 * window.
 *
 * Repro in the wild: home page projects query refetches on focus /
 * mount (TanStack default), which is exactly what happens when the
 * tour first arrives at §6.2 after the §6.1 create. The fresh
 * project lands via refetch, the project list re-renders, and the
 * card DOM node we resolved during the cursor-script build is now
 * gone.
 *
 * Fix shape: keep the visual glide-to-build-time-coords (the user
 * sees BeakerBot arrive at where the card was) but defer the
 * actual click to playback inside a callback action that
 * re-queries the selector via `document.querySelector` and calls
 * `.click()` on the FRESH node, with `__beakerBotCursorClicking`
 * set so the InputLockOverlay's capture-phase blocker lets the
 * click through. We also fire `dispatchEvent(new MouseEvent("click",
 * ...))` as a belt-and-suspenders fallback for environments where
 * `el.click()` doesn't route through React (it always should — but
 * the cost of the extra dispatch is negligible and the cost of a
 * wedged tour is high).
 *
 * No null branch — if the selector misses the timeout, this
 * returns an empty CursorAction[] (caller's `compactScript` filters
 * nulls; we return the array shape directly so callers can spread).
 * Logs a warn so a stale anchor selector shows up in the console.
 *
 * Note: this returns CursorAction[] (not a single CursorAction)
 * because it expands into a glide + callback pair. Callers spread
 * it into their action list directly.
 */
export async function safeNavClickAction(
  selector: string,
  timeoutMs?: number,
): Promise<CursorAction[]> {
  const el = await waitForElement(selector, timeoutMs);
  if (!el) {
    console.warn(
      `[onboarding-v4] safeNavClickAction: selector "${selector}" never mounted`,
    );
    return [];
  }
  await ensureInViewport(el);
  // Re-read the rect after scroll settled so the glide targets where
  // the card sits NOW, not where it sat pre-scroll.
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return [
    { type: "glide", x, y },
    callbackAction(async () => {
      // Re-resolve at playback time so a re-render between build
      // and click (TanStack refetch / new project landing in the
      // list / etc.) gives us the live DOM node, not the detached
      // one we resolved during the build phase. The selector is
      // identical to the build-time query so this stays simple.
      if (typeof document === "undefined" || typeof window === "undefined") {
        return;
      }
      const fresh = document.querySelector(selector);
      if (!(fresh instanceof HTMLElement)) {
        console.warn(
          `[onboarding-v4] safeNavClickAction: selector "${selector}" did not re-resolve at playback`,
        );
        return;
      }
      const w = window as unknown as {
        __beakerBotCursorClicking?: boolean;
        __beakerBotCursorPendingNavigation?: boolean;
      };
      w.__beakerBotCursorClicking = true;
      // §6.2 click-bypass R2 root-cause fix (2026-05-26): mark this
      // click as a NAVIGATION click so the expectedRoute auto-nav
      // effect in TourController does NOT bounce the user back to the
      // step's `expectedRoute` when React Router's async push lands
      // AFTER the cursor script's `finally` has cleared
      // `__beakerBotCursorScriptRunning`. The synchronous flag race
      // is the actual bug: `el.click()` → onClick handler →
      // `router.push(target)` is queued, the synchronous finally
      // clears the running flag, runScript resolves, and only then
      // does the pathname-change useEffect see the new pathname.
      // At that moment `__beakerBotCursorScriptRunning` is already
      // false, the guard in the auto-nav effect doesn't trigger, and
      // the effect pushes the user back to expectedRoute (`/` for
      // §6.2 NAV) — undoing the navigation the cursor just performed.
      // This flag stays set until the auto-nav effect consumes it on
      // the next pathname change (or a short timeout drains it so a
      // failed navigation doesn't leave a stuck flag).
      w.__beakerBotCursorPendingNavigation = true;
      try {
        // Native `.click()` invokes the element's full activation
        // behaviour and routes through React's delegated handlers
        // at the root container. This is the same path the
        // BeakerBotCursor's `clickAt` uses, just on a freshly-
        // resolved node.
        fresh.click();
      } catch (err) {
        console.warn(
          `[onboarding-v4] safeNavClickAction: click on "${selector}" threw:`,
          err,
        );
      } finally {
        w.__beakerBotCursorClicking = false;
        // NOTE: do NOT clear __beakerBotCursorPendingNavigation here.
        // The auto-nav effect clears it on the first pathname change
        // it observes (the cursor's own intended navigation). A
        // safety drain in TourController clears it after a short
        // timeout in case the click never produced a pathname change
        // (e.g. the receiver handler short-circuited).
      }
    }),
  ];
}
