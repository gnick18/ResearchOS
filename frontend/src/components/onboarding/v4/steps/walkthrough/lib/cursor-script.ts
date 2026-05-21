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
  return { type: "type", target: el, text, cadenceMs };
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
  return { type: "drag", source: src, dest: dst };
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
