"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — opt-in prompt step.
 *
 * Lab Mode manager 2026-05-22. The first step in the new Lab Mode
 * cluster. Asks the user Now / Later / Dismiss, persists the pick to
 * `sidecar.lab_mode_tour_choice`, and branches:
 *
 *   - Now      → `lab-mode-intro`. Cluster continues into the demo
 *                viewer walk.
 *   - Later    → skip to `lab-cleanup` (the only post-cluster lab
 *                step). The natural-Lab-Mode-entry trigger will
 *                re-prompt later.
 *   - Dismiss  → skip to `lab-cleanup`. Permanent. Settings re-run is
 *                the only path back.
 *
 * Lab Mode fix manager R1 (2026-05-22): R1 fix-pass migrated the
 * step from the inline three-button picker (which lived in a
 * `LabModePromptInner` React body + called `controller.branchTo`
 * directly + the wrapper step's completion was a misleading
 * `manualAdvance("Skip Lab Mode tour")`) to the declarative
 * `branchOn` completion primitive. The controller's branch-button
 * renderer now owns the three buttons. The sidecar persistence
 * lives in `branchOn`'s new `onChoose` hook (added in this fix-pass)
 * so the write happens BEFORE the controller dispatches the branch
 * advance — same end-state as the prior inline implementation, but
 * the step reads like every other walkthrough step instead of a
 * one-off bespoke component.
 *
 * Persistence contract: unlike HE-2 (which deliberately does NOT
 * write to the sidecar so the choice is re-asked on re-run), this
 * picker DOES write to `lab_mode_tour_choice`. The opt-in is a
 * tour-wide decision, not a single-step scope. `clearWizardCompletion`
 * also resets the field so a Settings re-run can re-prompt.
 *
 * Sidecar field naming history (preserved for the next contributor):
 *   - v3 / pre-redesign used `lab_tour_pending` + `lab_tour_dismissed_at`.
 *   - The new field `lab_mode_tour_choice` consolidates the three-state
 *     into a single nullable. The legacy fields remain populated for
 *     back-compat (some other surfaces still read them).
 */
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import type { TourStep } from "../../step-types";
import {
  buildWalkthroughStep,
  branchOn,
} from "../walkthrough/lib/step-helpers";

/** The three branch destinations. Centralized so tests can assert
 *  against them without hard-coding strings. */
export const LAB_MODE_PROMPT_BRANCHES = {
  now: "lab-mode-intro",
  later: "lab-cleanup",
  dismiss: "lab-cleanup",
} as const;

/** Branch-label → sidecar value map. Exported so the test suite can
 *  assert the wiring without re-deriving the mapping. */
export const LAB_MODE_PROMPT_LABEL_TO_PICK: Record<
  string,
  "now" | "later" | "dismiss"
> = {
  now: "now",
  later: "later",
  dismiss: "dismiss",
};

/**
 * Persistence hook fired by `branchOn`'s `onChoose` before the
 * controller advances. Writes `lab_mode_tour_choice` AND keeps the
 * legacy `lab_tour_pending` / `lab_tour_dismissed_at` mirrors in
 * sync so older readers don't drift while back-compat cleanup
 * lands. Exported for the test suite.
 */
export async function persistLabModePromptChoice(
  pick: "now" | "later" | "dismiss",
  deps: {
    getUsername: () => Promise<string | null>;
    patchSidecar: typeof patchOnboarding;
  } = {
    getUsername: () => getCurrentUserCached().then((u) => u ?? null),
    patchSidecar: patchOnboarding,
  },
): Promise<void> {
  const username = await deps.getUsername();
  if (!username) {
    // No active user — nothing to persist. The resume-guard in the
    // downstream lab-mode-* steps will re-route on the next launch
    // if the choice mattered, so a missed write here isn't fatal.
    return;
  }
  const dismissedAt = pick === "dismiss" ? new Date().toISOString() : null;
  await deps.patchSidecar(username, (cur) => ({
    ...cur,
    lab_mode_tour_choice: pick,
    // Back-compat mirror writes — the legacy fields keep their
    // existing semantics:
    //   - lab_tour_pending = true when the user picked Later
    //   - lab_tour_dismissed_at = ISO when the user picked Dismiss
    // A follow-up sub-bot can retire these after every reader migrates
    // to `lab_mode_tour_choice`.
    lab_tour_pending: pick === "later",
    lab_tour_dismissed_at: dismissedAt,
  }));
}

export const labModePromptStep: TourStep = buildWalkthroughStep({
  id: "lab-mode-prompt",
  pose: "thinking",
  speech: (
    <div
      data-step-id="lab-mode-prompt"
      data-testid="lab-mode-prompt"
      className="space-y-2"
    >
      <p>
        One last thing. You picked a lab account, so I can show you Lab
        Mode, a separate view that summarizes everything happening
        across your whole lab. Want a 5 minute walkthrough?
      </p>
    </div>
  ),
  // Lab Mode fix manager R1: declarative branchOn. The three buttons
  // render in the speech bubble via TourController's branch-button
  // renderer; onChoose persists the pick to the sidecar before the
  // controller's branchTo dispatch advances the tour.
  completion: branchOn(
    [
      {
        label: "now",
        buttonLabel: "Now (~5 min)",
        nextStep: LAB_MODE_PROMPT_BRANCHES.now,
      },
      {
        label: "later",
        buttonLabel: "Later, prompt me from Lab Mode",
        nextStep: LAB_MODE_PROMPT_BRANCHES.later,
      },
      {
        label: "dismiss",
        buttonLabel: "Dismiss, re-run from Settings",
        nextStep: LAB_MODE_PROMPT_BRANCHES.dismiss,
      },
    ],
    {
      onChoose: async ({ label }) => {
        const pick = LAB_MODE_PROMPT_LABEL_TO_PICK[label];
        if (!pick) return;
        try {
          await persistLabModePromptChoice(pick);
        } catch (err) {
          // Best-effort persistence. The branchTo still fires; the
          // resume-guard handles the next launch if the write
          // genuinely failed.
          console.error(
            "[onboarding-v4] lab-mode-prompt persistence failed",
            err,
          );
        }
      },
    },
  ),
  // All lab-mode-* steps gate on Q1=lab. Solo accounts skip the
  // entire cluster (step-machine LAB_MODE_STEP_IDS list).
  conditionalOn: (picks) => picks?.account_type === "lab",
});
