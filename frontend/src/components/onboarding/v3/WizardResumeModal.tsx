"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "@/components/BeakerBot";
import {
  patchOnboarding,
  type OnboardingSidecar,
  type WizardArtifact,
  type WizardResumeState,
} from "@/lib/onboarding/sidecar";
import type { WizardStep } from "./WizardStepMachine";

/**
 * P5's mid-walkthrough close modal (ONBOARDING_V3_PROPOSAL.md §8 L10
 * lock). Fires when WizardMount's mount probe finds a non-null
 * `wizard_resume_state` on the sidecar AND the wizard would otherwise
 * mount (fresh user OR `wizard_force_show=true`).
 *
 * The three buttons map to the L10 verbatim flow:
 *   - Resume   restore the saved `current_step`, keep all
 *              `artifacts_created`, close the modal so the wizard shell
 *              mounts at the saved step.
 *   - Restart  open a confirm sub-modal. On confirm: attempt artifact
 *              cleanup (Path B inline stub, see restartCleanup below),
 *              clear `wizard_resume_state`, signal parent to mount the
 *              wizard at intro. On cancel: return to the Resume modal.
 *   - Discard  clear `wizard_resume_state`, set `wizard_skipped_at`,
 *              keep artifacts in place. The modal closes and the wizard
 *              does NOT mount. Settings "Re-run welcome tour" still
 *              works because `clearWizardCompletion()` clears
 *              `wizard_skipped_at`.
 *
 * Persistence is owned by the modal (mirrors LabTourResumePrompt
 * pattern from P3b): patchOnboarding is called directly here and the
 * parent callbacks signal what UI state to flip to once the write
 * resolves. The parent's own sidecar copy gets refreshed via the
 * callback's caller in WizardMount.
 *
 * Cleanup-execution path (per brief §3): Path B inline. P4 will ship a
 * `cleanupArtifacts(artifacts)` shared helper as part of the cleanup
 * grid; once that lands, a follow-up XS chip can refactor restartCleanup
 * below to call into the shared helper instead of the inline stub.
 *
 * Voice (L14): funny + playful BeakerBot. No em-dashes anywhere in
 * the copy (Grant's prose preference).
 */

type UiState = "idle" | "confirming-restart" | "persisting";

interface WizardResumeModalProps {
  username: string;
  resumeState: WizardResumeState;
  /** Parent flips to "wizard mounts at saved step" + closes modal. */
  onResume: (savedStep: WizardStep) => void;
  /** Parent flips initialStep to "intro" + closes modal. The modal has
   *  already cleared `wizard_resume_state` and attempted artifact
   *  cleanup by the time this fires. */
  onRestart: () => void;
  /** Parent unmounts the wizard entirely. The modal has already
   *  cleared `wizard_resume_state` and set `wizard_skipped_at` by the
   *  time this fires. */
  onDiscard: () => void;
}

/**
 * Inline best-effort cleanup. P4 will export a shared helper that
 * handles each artifact type via its domain API (projects, methods,
 * experiments, purchases, calendar feeds, telegram links, lab users,
 * lab tasks, settings_change, hybrid_edit). Until that ships, Restart
 * clears the wizard's tracking metadata (so a re-run starts fresh) and
 * leaves any side effects in place; the user can clean them up via the
 * normal feature surfaces.
 *
 * The console.warn is intentional: during the P5-to-P4 gap we want
 * Restart paths visible in dev logs so anyone testing the modal can
 * see what would be deleted once P4 wires in real cleanup.
 *
 * TODO P4: replace the body below with a call into the shared
 * cleanupArtifacts helper.
 */
async function restartCleanup(
  artifacts: ReadonlyArray<WizardArtifact>,
): Promise<void> {
  if (artifacts.length === 0) return;
  if (typeof console !== "undefined" && console.warn) {
    console.warn(
      "[onboarding-v3] WizardResumeModal Restart fired with %d artifact(s); P4 cleanupArtifacts not yet wired, only the tracking metadata is being cleared",
      artifacts.length,
      artifacts.map((a) => `${a.type}:${a.id}`),
    );
  }
}

function summarizeProgress(resume: WizardResumeState): string {
  const created = resume.artifacts_created.length;
  if (created === 0) {
    return `You were on step ${resume.current_step}. Nothing in your folder has been changed yet.`;
  }
  if (created === 1) {
    return `You were on step ${resume.current_step}, and BeakerBot helped you make 1 thing so far.`;
  }
  return `You were on step ${resume.current_step}, and BeakerBot helped you make ${created} things so far.`;
}

export default function WizardResumeModal({
  username,
  resumeState,
  onResume,
  onRestart,
  onDiscard,
}: WizardResumeModalProps) {
  const [uiState, setUiState] = useState<UiState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleResume = useCallback(() => {
    // No persistence needed: the saved step + artifacts already live
    // on the sidecar and the parent's `initialStep` is already pointing
    // at the resumed step. We just close the modal and let the wizard
    // shell mount.
    onResume(resumeState.current_step as WizardStep);
  }, [onResume, resumeState.current_step]);

  const handleRestartClick = useCallback(() => {
    setUiState("confirming-restart");
    setErrorMessage(null);
  }, []);

  const handleRestartCancel = useCallback(() => {
    setUiState("idle");
    setErrorMessage(null);
  }, []);

  const handleRestartConfirm = useCallback(async () => {
    setUiState("persisting");
    setErrorMessage(null);
    try {
      await restartCleanup(resumeState.artifacts_created);
      await patchOnboarding(username, (cur: OnboardingSidecar) => ({
        ...cur,
        wizard_resume_state: null,
      }));
      onRestart();
    } catch (err) {
      console.error("[onboarding-v3] WizardResumeModal Restart failed", err);
      setUiState("confirming-restart");
      setErrorMessage("Could not reset progress. Try again or pick Resume.");
    }
  }, [onRestart, resumeState.artifacts_created, username]);

  const handleDiscard = useCallback(async () => {
    setUiState("persisting");
    setErrorMessage(null);
    try {
      const skippedAt = new Date().toISOString();
      await patchOnboarding(username, (cur: OnboardingSidecar) => ({
        ...cur,
        wizard_resume_state: null,
        wizard_skipped_at: skippedAt,
        wizard_force_show: false,
      }));
      onDiscard();
    } catch (err) {
      console.error("[onboarding-v3] WizardResumeModal Discard failed", err);
      setUiState("idle");
      setErrorMessage("Could not save that. Try again or pick Resume.");
    }
  }, [onDiscard, username]);

  if (typeof document === "undefined") return null;

  const persisting = uiState === "persisting";
  const confirming = uiState === "confirming-restart";
  const hasArtifacts = resumeState.artifacts_created.length > 0;
  const confirmCopy = hasArtifacts
    ? "This will delete the items BeakerBot helped you make so far. Continue?"
    : "This will reset your progress. Continue?";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-resume-modal-title"
      data-resume-modal-state={uiState}
      className="fixed inset-0 z-[350] flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[480px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex-shrink-0"
              style={{ width: 64, height: 64 }}
            >
              <BeakerBot
                pose="waving"
                direction="right"
                className="w-full h-full text-sky-500"
              />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="wizard-resume-modal-title"
                className="text-lg font-semibold text-gray-900"
              >
                Welcome back!
              </h2>
              <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                {summarizeProgress(resumeState)} Want to pick up where you
                left off, start over, or call it done?
              </p>
            </div>
          </div>
        </div>

        {confirming ? (
          <div className="px-6 py-5 flex flex-col gap-3">
            <p
              className="text-sm text-gray-800"
              data-resume-modal-confirm-copy=""
            >
              {confirmCopy}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handleRestartConfirm()}
                disabled={persisting}
                data-resume-modal-action="restart-confirm"
                className="px-4 py-3 text-sm font-medium rounded-lg border border-rose-500 bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50 text-left"
              >
                <div className="font-semibold">Yes, start over</div>
                <div className="text-xs text-rose-50 mt-0.5">
                  {hasArtifacts
                    ? "BeakerBot will tidy up and reset the walkthrough."
                    : "Restart the walkthrough from the beginning."}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleRestartCancel()}
                disabled={persisting}
                data-resume-modal-action="restart-cancel"
                className="px-4 py-3 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50 text-left"
              >
                <div className="font-semibold">Never mind</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  Go back to the previous choices.
                </div>
              </button>
            </div>
            {errorMessage && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {errorMessage}
              </p>
            )}
          </div>
        ) : (
          <div className="px-6 py-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => handleResume()}
              disabled={persisting}
              data-resume-modal-action="resume"
              className="px-4 py-3 text-sm font-medium rounded-lg border border-sky-500 bg-sky-500 text-white hover:bg-sky-600 transition-colors disabled:opacity-50 text-left"
            >
              <div className="font-semibold">Resume</div>
              <div className="text-xs text-sky-50 mt-0.5">
                Pick up right where you left off.
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleRestartClick()}
              disabled={persisting}
              data-resume-modal-action="restart"
              className="px-4 py-3 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50 text-left"
            >
              <div className="font-semibold">Restart</div>
              <div className="text-xs text-gray-600 mt-0.5">
                Start the walkthrough over from the beginning.
              </div>
            </button>
            <button
              type="button"
              onClick={() => void handleDiscard()}
              disabled={persisting}
              data-resume-modal-action="discard"
              className="px-4 py-3 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50 text-left"
            >
              <div className="font-semibold">I&apos;m good, call it done</div>
              <div className="text-xs text-gray-600 mt-0.5">
                Close the walkthrough. You can re-run it from Settings any time.
              </div>
            </button>
            {errorMessage && (
              <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
