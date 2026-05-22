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
import { recordBranchChoice } from "./lib/branch-choices";

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
  onExit: async () => {
    // Branch-choice recording (R1 fix-pass P1 #7). The step-machine
    // gate for HE-3 reads the most recent recorded choice via
    // `lastBranchChoice("hybrid-markdown-familiarity")` so back-stepping
    // from HE-4 to HE-3 lands on HE-4 (the previous applicable step)
    // when the user declined the overview, instead of re-landing on
    // HE-3 itself. The choice persists in a module-level cache scoped
    // to the tour session.
    //
    // We can't know which branch was clicked from inside onExit (the
    // step's completion is opaque here), so we let the branch buttons
    // record into the same cache via the controller's branchTo path.
    // This onExit is the cleanup fence: clear any stale recording when
    // the step exits without a branch click (e.g. step skipped). The
    // record-on-click path runs from TourController.tsx's branchTo
    // dispatch and overwrites whatever onExit cleared.
    recordBranchChoice("hybrid-markdown-familiarity", null);
  },
});
