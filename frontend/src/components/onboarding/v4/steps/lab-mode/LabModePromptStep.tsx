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
 * Why branchOn vs the v3-era manual branching:
 *   - Hybrid editor manager 2026-05-22 landed `branchOn` for the HE-2
 *     gate. Re-using that primitive here keeps the in-tour-choice
 *     plumbing single-sourced. Each branch's `nextStep` is the exact
 *     jump target; the controller's `branchTo` honors it verbatim
 *     (no gating recheck), which is what we want for both
 *     skip-the-cluster paths.
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
import { useEffect, useRef, useState } from "react";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";
import { buildWalkthroughStep, manualAdvance } from "../walkthrough/lib/step-helpers";

/** The three branch destinations. Centralized so tests can assert
 *  against them without hard-coding strings. */
export const LAB_MODE_PROMPT_BRANCHES = {
  now: "lab-mode-intro",
  later: "lab-cleanup",
  dismiss: "lab-cleanup",
} as const;

interface LabModePromptInnerProps {
  /** Test override for the patchOnboarding call so the suite doesn't
   *  have to mount a real fileService. */
  patchSidecar?: (
    username: string,
    pick: "now" | "later" | "dismiss",
  ) => Promise<void>;
}

function LabModePromptInner({ patchSidecar }: LabModePromptInnerProps) {
  const controller = useTourController();
  const [busy, setBusy] = useState<"now" | "later" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickedRef = useRef(false);

  // Default persistence: write `lab_mode_tour_choice` AND keep the
  // legacy `lab_tour_pending` / `lab_tour_dismissed_at` fields in
  // sync so surfaces reading the old shape don't drift while the
  // back-compat cleanup is pending.
  const defaultPatchSidecar = async (
    username: string,
    pick: "now" | "later" | "dismiss",
  ): Promise<void> => {
    const dismissedAt = pick === "dismiss" ? new Date().toISOString() : null;
    await patchOnboarding(username, (cur) => ({
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
  };

  const persistPick = async (
    pick: "now" | "later" | "dismiss",
  ): Promise<boolean> => {
    setBusy(pick);
    setError(null);
    try {
      const username = await getCurrentUserCached();
      if (!username) {
        setError(
          "Couldn't read your username. Try again, or skip this step.",
        );
        return false;
      }
      const fn = patchSidecar ?? defaultPatchSidecar;
      await fn(username, pick);
      return true;
    } catch (err) {
      console.error("[onboarding-v4] lab-mode-prompt persist failed", err);
      setError("Couldn't save that. Try again, or skip this step.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handlePick = async (
    pick: "now" | "later" | "dismiss",
    target: string,
  ): Promise<void> => {
    if (busy) return;
    if (pickedRef.current) return;
    pickedRef.current = true;
    const ok = await persistPick(pick);
    if (!ok) {
      pickedRef.current = false;
      return;
    }
    controller.branchTo(target);
  };

  // Resume safety: if the user already made a pick (refresh /
  // back-step / re-mount) but the controller put them back on
  // `lab-mode-prompt`, the buttons are still live. We don't
  // auto-advance on mount because Grant's design rule is "manual
  // pacing between beats" — the user can re-pick, which is fine since
  // the sidecar write is idempotent. We only block double-clicks via
  // `pickedRef`.
  useEffect(() => {
    return () => {
      pickedRef.current = false;
    };
  }, []);

  return (
    <div
      data-step-id="lab-mode-prompt"
      data-testid="lab-mode-prompt"
      className="space-y-3"
    >
      <div className="leading-relaxed">
        One last thing. You picked a lab account, so I can show you Lab
        Mode, a separate view that summarizes everything happening
        across your whole lab. Want a 5 minute walkthrough?
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void handlePick("now", LAB_MODE_PROMPT_BRANCHES.now)}
          disabled={busy !== null}
          data-branch-label="now"
          data-lab-mode-pick="now"
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 text-left transition-colors"
        >
          Now ({"~"}5 min)
        </button>
        <button
          type="button"
          onClick={() =>
            void handlePick("later", LAB_MODE_PROMPT_BRANCHES.later)
          }
          disabled={busy !== null}
          data-branch-label="later"
          data-lab-mode-pick="later"
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-sky-50 hover:border-sky-300 text-gray-800 disabled:opacity-50 text-left transition-colors"
        >
          Later, I&apos;ll prompt you the first time you open Lab Mode
        </button>
        <button
          type="button"
          onClick={() =>
            void handlePick("dismiss", LAB_MODE_PROMPT_BRANCHES.dismiss)
          }
          disabled={busy !== null}
          data-branch-label="dismiss"
          data-lab-mode-pick="dismiss"
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 text-left transition-colors"
        >
          Dismiss, re-run from Settings any time
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

export const labModePromptStep: TourStep = buildWalkthroughStep({
  id: "lab-mode-prompt",
  pose: "thinking",
  speech: () => <LabModePromptInner />,
  // Keyboard-only fallback. The three buttons inside the speech
  // handle the actual branching; this label only shows when a user
  // tabs to the default affordance.
  completion: manualAdvance("Skip Lab Mode tour"),
  // All lab-mode-* steps gate on Q1=lab. Solo accounts skip the
  // entire cluster (step-machine LAB_MODE_STEP_IDS list).
  conditionalOn: (picks) => picks?.account_type === "lab",
});

export default LabModePromptInner;
