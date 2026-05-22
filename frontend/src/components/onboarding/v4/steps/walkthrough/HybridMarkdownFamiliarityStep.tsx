"use client";

/**
 * §6.7 HE-2 — markdown familiarity in-tour gate.
 *
 * Hybrid editor manager 2026-05-22. Asks the user whether they already
 * know markdown:
 *   - "Yes, I know markdown" → jump to HE-4 (skip the overview).
 *   - "No, never used it"   → speech updates with a follow-up question:
 *       - "Sure, show me"        → jump to HE-3 (overview).
 *       - "Skip, I'll learn as I go" → jump to HE-4.
 *
 * Per Grant's 2026-05-22 design: the choice is NOT persisted to the
 * sidecar. Re-running the tour asks again. The branch scopes one
 * downstream step only.
 *
 * Implementation: the speech bubble renders the picker UI (same shape
 * as MethodsCategoryPromptStep). The TourStep's `completion` is
 * `manual` (so the controller has a default "Skip" affordance for
 * keyboard-only users); the buttons call `branchTo` directly to set
 * the next step id.
 */
import { useState } from "react";
import { useTourController } from "../../TourController";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

/** The three terminal branch targets. Kept in one place so the test
 *  suite can assert against them without hard-coding strings. */
export const HE2_BRANCH_TARGETS = {
  knowsMarkdown: "hybrid-editor-mechanic",
  wantsOverview: "hybrid-markdown-overview",
  skipOverview: "hybrid-editor-mechanic",
} as const;

/** Inner picker component. Holds the "no, ask again" toggle state
 *  locally; calls `branchTo` on each terminal pick. */
function HybridMarkdownFamiliarityInner() {
  const controller = useTourController();
  const [askedFollowUp, setAskedFollowUp] = useState(false);

  if (!askedFollowUp) {
    return (
      <div
        data-step-id="hybrid-markdown-familiarity"
        data-testid="hybrid-markdown-familiarity"
        className="space-y-3"
      >
        <div className="leading-relaxed">
          Quick check, have you used markdown before?
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => controller.branchTo(HE2_BRANCH_TARGETS.knowsMarkdown)}
            data-branch-label="yes-knows-markdown"
            className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-sky-50 hover:border-sky-300 text-gray-800 text-left transition-colors"
          >
            Yes, I know markdown
          </button>
          <button
            type="button"
            onClick={() => setAskedFollowUp(true)}
            data-branch-label="no-never-used"
            className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-sky-50 hover:border-sky-300 text-gray-800 text-left transition-colors"
          >
            No, never used it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-step-id="hybrid-markdown-familiarity"
      data-testid="hybrid-markdown-familiarity"
      className="space-y-3"
    >
      <div className="leading-relaxed">
        No worries. Want a quick overview? It&apos;ll take 30 seconds.
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => controller.branchTo(HE2_BRANCH_TARGETS.wantsOverview)}
          data-branch-label="sure-show-me"
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-sky-50 hover:border-sky-300 text-gray-800 text-left transition-colors"
        >
          Sure, show me
        </button>
        <button
          type="button"
          onClick={() => controller.branchTo(HE2_BRANCH_TARGETS.skipOverview)}
          data-branch-label="skip-learn-as-i-go"
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-sky-50 hover:border-sky-300 text-gray-800 text-left transition-colors"
        >
          Skip, I&apos;ll learn as I go
        </button>
      </div>
    </div>
  );
}

export const hybridMarkdownFamiliarityStep = buildWalkthroughStep({
  id: "hybrid-markdown-familiarity",
  speech: () => <HybridMarkdownFamiliarityInner />,
  pose: "thinking",
  // Manual completion exists for the keyboard-only "Skip" path the
  // controller renders as a fallback button. The two inner-picker
  // buttons call `branchTo` directly, bypassing manual advance.
  completion: manualAdvance("Skip"),
});

export default HybridMarkdownFamiliarityInner;
