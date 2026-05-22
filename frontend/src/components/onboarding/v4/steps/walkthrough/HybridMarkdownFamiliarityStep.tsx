"use client";

/**
 * §6.7 HE-2 — markdown familiarity in-tour gate.
 *
 * Hybrid editor manager 2026-05-22. Asks the user whether they already
 * know markdown, then routes to either the overview (HE-3) or directly
 * to the mechanic step (HE-4).
 *
 * R1 fix-pass (Hybrid fix manager R1, 2026-05-22): switched to the
 * proper `branchOn` completion primitive and dropped the inline picker
 * UI. The previous implementation used `manualAdvance("Skip")` plus a
 * hand-rolled inner React component that called `controller.branchTo`
 * directly. The "Skip" fallback completion was wired BACKWARDS —
 * clicking it called `advance()` which routed to HE-3, the overview
 * the user had just declined. With `branchOn`, the controller renders
 * one button per branch in the speech bubble. The bubble's speech is
 * now pure narration of the question, all three branches surface as
 * a single 3-button choice the user picks once.
 *
 * Choice → destination mapping:
 *   - "Yes, I know markdown"           → HE-4 (skip the overview).
 *   - "Sure, show me an overview"      → HE-3 (the overview step).
 *   - "Skip, I'll learn as I go"       → HE-4 (skip the overview).
 *
 * Per Grant's 2026-05-22 design: the choice is NOT persisted to the
 * sidecar. Re-running the tour asks again. The branch scopes one
 * downstream step only.
 */
import { buildWalkthroughStep, branchOn } from "./lib/step-helpers";

/** The three terminal branch targets. Kept in one place so the test
 *  suite can assert against them without hard-coding strings. */
export const HE2_BRANCH_TARGETS = {
  knowsMarkdown: "hybrid-editor-mechanic",
  wantsOverview: "hybrid-markdown-overview",
  skipOverview: "hybrid-editor-mechanic",
} as const;

export const hybridMarkdownFamiliarityStep = buildWalkthroughStep({
  id: "hybrid-markdown-familiarity",
  speech: (
    <>
      <p className="mb-2">
        Quick check, have you used markdown before?
      </p>
      <p>
        If yes, we&apos;ll skip the overview. If not, want a 30-second
        crash course?
      </p>
    </>
  ),
  pose: "thinking",
  // R1 fix-pass: declarative branchOn completion. The controller
  // renders the three buttons below the speech (see
  // TourController.tsx's branch-completion render path). Each
  // button's nextStep maps directly to the destination step id.
  completion: branchOn([
    {
      label: "yes-knows-markdown",
      buttonLabel: "Yes, I know markdown",
      nextStep: HE2_BRANCH_TARGETS.knowsMarkdown,
    },
    {
      label: "sure-show-me-overview",
      buttonLabel: "Sure, show me an overview",
      nextStep: HE2_BRANCH_TARGETS.wantsOverview,
    },
    {
      label: "skip-learn-as-i-go",
      buttonLabel: "Skip, I'll learn as I go",
      nextStep: HE2_BRANCH_TARGETS.skipOverview,
    },
  ]),
  // R2 fix-pass (Hybrid fix manager R2, 2026-05-22 — P1): no onExit
  // clear. The previous implementation called
  // `recordBranchChoice("hybrid-markdown-familiarity", null)` every
  // time HE-2 exited, including the forward branch-click path. The
  // branch-click writes via TourController.branchTo's
  // `recordBranchChoice` happen BEFORE the SET_STEP dispatch, then
  // this onExit ran AFTER the controller advanced, wiping the just-
  // recorded choice. Back-stepping from HE-4 to HE-3 then read the
  // wiped (null) choice and gated HE-3 OUT, so back-step skipped HE-3
  // even when the user had explicitly picked the overview branch.
  //
  // The cache lifecycle is now tour-session-scoped (cleared on
  // `endTour()` via `resetBranchChoices()` in TourController.tsx),
  // matching the contract documented in lib/branch-choices.ts. Skip
  // paths (manualAdvance without a branch click) don't write to the
  // cache, so leaving any prior recording in place is fine: HE-2 is
  // a `branchOn` step, the only way to advance is to click a branch.
});
