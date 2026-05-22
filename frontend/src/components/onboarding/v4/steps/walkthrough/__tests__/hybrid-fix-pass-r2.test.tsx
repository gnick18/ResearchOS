/**
 * Regression-pinning tests for the §6.7 hybrid editor R2 fix-pass.
 *
 * Each test corresponds to one P0/P1/P2 fix from the R2 brief.
 *
 * Hybrid fix manager R2, 2026-05-22.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { clickOutsideEditorAction } from "../lib/cursor-script";
import { hybridMarkdownFamiliarityStep } from "../HybridMarkdownFamiliarityStep";
import { hybridMarkdownOverviewStep } from "../HybridMarkdownOverviewStep";
import { hybridShortcutsStep } from "../HybridShortcutsStep";
import { hybridFileAttachStep } from "../HybridFileAttachStep";
import { hybridBoldStep } from "../HybridBoldStep";
import {
  lastBranchChoice,
  recordBranchChoice,
  resetBranchChoices,
} from "../lib/branch-choices";
import { isStepGatedOut } from "../../../step-machine";

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

describe("R2 fix-pass P0: clickOutsideEditorAction bypasses InputLockOverlay", () => {
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

describe("R2 fix-pass P1: HE-2 onExit no longer wipes the branch choice", () => {
  it("HE-2 has no onExit clear (the R1 onExit wiped the choice the user just made)", () => {
    // The R1 implementation had:
    //   onExit: async () => { recordBranchChoice(..., null); }
    // That clear ran AFTER TourController.branchTo wrote the branch
    // choice → SET_STEP, wiping the just-recorded selection. Back-
    // stepping from HE-4 to HE-3 then read null and gated HE-3 OUT,
    // even though the user picked the overview branch.
    expect(hybridMarkdownFamiliarityStep.onExit).toBeUndefined();
  });

  it("back-step path: HE-2 → pick overview → HE-3 → HE-4 → back-step lands on HE-3, not HE-2", () => {
    // Simulate the flow: HE-2 branch click writes via
    // TourController.branchTo, which calls recordBranchChoice
    // BEFORE the SET_STEP dispatch. We replicate that write here.
    resetBranchChoices();
    recordBranchChoice(
      "hybrid-markdown-familiarity",
      "hybrid-markdown-overview",
    );

    // User advances HE-3 → HE-4 via normal manualAdvance. The R1
    // bug would have fired HE-2's onExit (which was never actually
    // tied to a forward branch click, but instead fired on EVERY
    // HE-2 exit including the branch path) and wiped the choice.
    // The R2 fix removes that onExit → the choice survives.

    // Now back-step from HE-4: the step-machine's getPreviousStep
    // walks backwards and asks isStepGatedOut for each candidate.
    // HE-3's gate reads lastBranchChoice; with the choice still
    // intact, HE-3 should NOT be gated out.
    expect(lastBranchChoice("hybrid-markdown-familiarity")).toBe(
      "hybrid-markdown-overview",
    );
    expect(isStepGatedOut("hybrid-markdown-overview", null)).toBe(false);
    resetBranchChoices();
  });

  it("forward-path: HE-2 skip branch still gates HE-3 OUT for the same session", () => {
    // The skip / yes-knows-markdown paths route HE-2 directly to
    // HE-4. The step-machine's gate must keep HE-3 OUT for back-
    // stepping in those flows too.
    resetBranchChoices();
    recordBranchChoice(
      "hybrid-markdown-familiarity",
      "hybrid-editor-mechanic",
    );
    expect(isStepGatedOut("hybrid-markdown-overview", null)).toBe(true);
    resetBranchChoices();
  });
});

describe("R2 fix-pass P1: HE-3 paragraph 3 restored with corrected location", () => {
  it("speech includes the 'shortcut bar on the left' framing the spec mandates", () => {
    const speech =
      typeof hybridMarkdownOverviewStep.speech === "function"
        ? hybridMarkdownOverviewStep.speech()
        : hybridMarkdownOverviewStep.speech;
    const { container } = render(<>{speech}</>);
    const text = container.textContent ?? "";
    expect(text).toMatch(/shortcut bar on the left/i);
    expect(text).toMatch(/memorize/i);
  });
});

describe("R2 fix-pass P1: HE-7 speech includes the Cmd+B framing from spec line 131", () => {
  it("speech mentions Cmd+B (the spec-mandated framing) alongside Cmd+I and Cmd+U", () => {
    const speech =
      typeof hybridShortcutsStep.speech === "function"
        ? hybridShortcutsStep.speech()
        : hybridShortcutsStep.speech;
    const { container } = render(<>{speech}</>);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Cmd\+B/);
    expect(text).toMatch(/Cmd\+I/);
    expect(text).toMatch(/Cmd\+U/);
    expect(text).toMatch(/Word shortcuts/i);
  });
});

describe("R2 fix-pass P1: HE-11 speech restores the PDF/text disclosure", () => {
  it("speech mentions PDFs and text files (spec line 168-170)", () => {
    const speech =
      typeof hybridFileAttachStep.speech === "function"
        ? hybridFileAttachStep.speech()
        : hybridFileAttachStep.speech;
    const { container } = render(<>{speech}</>);
    const text = container.textContent ?? "";
    expect(text).toMatch(/PDFs/);
    expect(text).toMatch(/text files/i);
    expect(text).toMatch(/directly/i);
    expect(text).toMatch(/download/i);
  });

  it("speech no longer says 'drag in' (the cursor uses callbackAction, not real drag)", () => {
    const speech =
      typeof hybridFileAttachStep.speech === "function"
        ? hybridFileAttachStep.speech()
        : hybridFileAttachStep.speech;
    const { container } = render(<>{speech}</>);
    const text = container.textContent ?? "";
    // Match the verb usage specifically. "drag in" is the
    // unsupported claim. "attach" is fine.
    expect(text).not.toMatch(/drag in/i);
    expect(text).not.toMatch(/drag them in/i);
  });
});

describe("R2 fix-pass P2: em-dash leak in typing pill copy", () => {
  it("HE-5 typing pill uses comma, not em-dash", () => {
    const pill = hybridBoldStep.pageLock?.pillLabel ?? "";
    expect(pill).not.toMatch(/—/);
    expect(pill).toMatch(/back in a sec/i);
  });
});
