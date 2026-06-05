/**
 * Regression-pinning tests for `clickOutsideEditorAction`.
 *
 * Inline-editor collapse (onboarding-inline bot 2026-06-02): the §6.7
 * markdown deep-dive (HE-1..HE-11) collapsed into the single `inline-editor`
 * beat now that the editor is inline-only. The per-step R2 fix-pass tests
 * that pinned the deleted hybrid bold / shortcuts / file-attach / markdown
 * familiarity / overview behaviors are gone with those steps.
 *
 * `clickOutsideEditorAction` itself survives in `lib/cursor-script.ts` and
 * is still used by cursor scripts; its bypass-the-InputLockOverlay contract
 * is retained here.
 */
import { describe, expect, it } from "vitest";
import { clickOutsideEditorAction } from "../lib/cursor-script";

/**
 * Helper: mirror `InputLockOverlay`'s capture-phase window listener
 * so the test asserts the bypass flag works end-to-end. The real
 * overlay calls `preventDefault()` + `stopPropagation()` on any
 * mousedown/click unless `window.__beakerBotCursorClicking` is true.
 */
function attachOverlayBlocker(): { detach: () => void; blockedCount: () => number } {
  let blocked = 0;
  const handler = (e: Event) => {
    if (
      (window as unknown as { __beakerBotCursorClicking?: boolean })
        .__beakerBotCursorClicking
    ) {
      return;
    }
    blocked += 1;
    e.preventDefault();
    e.stopPropagation();
  };
  const opts = { capture: true, passive: false } as const;
  window.addEventListener("mousedown", handler, opts);
  window.addEventListener("mouseup", handler, opts);
  window.addEventListener("click", handler, opts);
  return {
    detach: () => {
      window.removeEventListener("mousedown", handler, opts);
      window.removeEventListener("mouseup", handler, opts);
      window.removeEventListener("click", handler, opts);
    },
    blockedCount: () => blocked,
  };
}

describe("clickOutsideEditorAction bypasses InputLockOverlay", () => {
  it("returns a callback action (not a click) so the cursor ripple isn't misleading", () => {
    const action = clickOutsideEditorAction();
    expect(action.type).toBe("callback");
  });

  it("sets window.__beakerBotCursorClicking around the dispatch so the overlay's capture-phase blocker short-circuits", async () => {
    const blocker = attachOverlayBlocker();
    try {
      // Listener that proves the editor's document-level mousedown
      // handler runs. The R1 implementation never reached this
      // listener because the overlay's capture-phase
      // stopPropagation() ran first and short-circuited the bubble.
      let editorMousedownFired = false;
      const editorHandler = () => {
        editorMousedownFired = true;
      };
      document.addEventListener("mousedown", editorHandler);

      const action = clickOutsideEditorAction();
      // Sanity narrowing — the action is a callback variant.
      if (action.type !== "callback") {
        throw new Error("expected callback action");
      }
      await action.fn();

      expect(editorMousedownFired).toBe(true);
      // The overlay blocker did NOT block any event — the bypass flag
      // routed the dispatch past it. If the flag had not been set
      // around the dispatch, mousedown + mouseup + click would each
      // have incremented the blocked count.
      expect(blocker.blockedCount()).toBe(0);

      document.removeEventListener("mousedown", editorHandler);
    } finally {
      blocker.detach();
    }
  });

  it("clears window.__beakerBotCursorClicking after the dispatch (no flag leak)", async () => {
    const w = window as unknown as { __beakerBotCursorClicking?: boolean };
    w.__beakerBotCursorClicking = false;
    const action = clickOutsideEditorAction();
    if (action.type !== "callback") {
      throw new Error("expected callback action");
    }
    await action.fn();
    expect(w.__beakerBotCursorClicking).toBe(false);
  });

  it("clears window.__beakerBotCursorClicking when dispatchEvent throws (try/finally guard)", async () => {
    const w = window as unknown as { __beakerBotCursorClicking?: boolean };
    w.__beakerBotCursorClicking = false;
    // Patch document.body.dispatchEvent to throw synchronously so
    // we exercise the inner try/catch + the outer try/finally clause
    // that clears the flag. Restored in the finally block below.
    const original = document.body.dispatchEvent;
    document.body.dispatchEvent = (() => {
      throw new Error("simulated dispatch failure");
    }) as typeof document.body.dispatchEvent;
    try {
      const action = clickOutsideEditorAction();
      if (action.type !== "callback") {
        throw new Error("expected callback action");
      }
      await action.fn();
      expect(w.__beakerBotCursorClicking).toBe(false);
    } finally {
      document.body.dispatchEvent = original;
    }
  });
});
