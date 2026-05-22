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
  fn: () => void | Promise<void>,
): CursorAction {
  return { type: "callback", fn };
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
