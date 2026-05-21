"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
} from "@/lib/onboarding/sidecar";

/**
 * P3b's natural-Lab-Mode-entry trigger for the deferred Lab tour
 * (ONBOARDING_V3_PROPOSAL.md §8 L18 lock).
 *
 * Mount precedence: this lives as a sibling to OnboardingProvider in
 * providers.tsx. The OnboardingProvider already short-circuits in
 * demo / wiki-capture modes (the providers.tsx outer conditional
 * peels those off before reaching the signed-in branch), so this
 * component never renders against fixtures.
 *
 * Entry signal: `usePathname()` from next/navigation. Lab Mode lives
 * at `/lab` (frontend/src/app/lab/page.tsx). We track the previous
 * pathname in a ref so the modal only fires on the false-to-true
 * transition into /lab. The first mount's previous pathname is
 * `null`, which we treat as "no transition yet" — that covers the
 * brief's edge case: a user who picks Later on the lab-prompt step
 * while already at /lab does NOT see the modal in the same session,
 * because no transition occurred. They have to leave /lab and come
 * back for the trigger to fire.
 *
 * Visibility gate: all four conditions must hold on the freshly-read
 * sidecar at transition time:
 *   - `lab_tour_pending === true`
 *   - `lab_tour_dismissed_at === null`
 *   - `feature_picks?.account_type === "lab"`
 *   - the wizard itself is not in flight (`wizard_completed_at` or
 *     `wizard_skipped_at` is set) — otherwise the user is still
 *     mid-wizard and the resume prompt would race the wizard modal.
 *
 * Buttons:
 *   - Now    → clear `lab_tour_pending`, set `wizard_force_show=true`
 *              + `wizard_resume_state.current_step="L1"`, reload the
 *              page. WizardMount picks up the force-show flag and
 *              mounts the wizard at L1 (the first lab tour step;
 *              skips the lab-prompt re-offer since the user already
 *              re-confirmed via this modal).
 *   - Snooze → close the modal. `lab_tour_pending` stays `true`, so
 *              the next natural /lab entry re-fires this prompt.
 *   - Dismiss → clear `lab_tour_pending` AND set
 *               `lab_tour_dismissed_at = <ISO>`. Permanent for the
 *               auto-fire path. Settings "Re-run welcome tour"
 *               (`clearWizardCompletion()`) clears both
 *               `lab_tour_pending` and `lab_tour_dismissed_at`
 *               (P3b master-locked sidecar.ts extension) so a re-run
 *               is a full fresh start across all wizard surfaces.
 */

interface LabTourResumePromptProps {
  username: string;
}

type UiState = "idle" | "persisting" | "error";

function shouldShowPrompt(sidecar: OnboardingSidecar): boolean {
  if (sidecar.lab_tour_dismissed_at) return false;
  if (!sidecar.lab_tour_pending) return false;
  if (sidecar.feature_picks?.account_type !== "lab") return false;
  // Wait until the wizard is done (completed or skipped wholesale) so
  // the resume modal doesn't race the wizard's own modal. The only way
  // `lab_tour_pending=true` lands in the sidecar is via the lab-prompt
  // step's Later branch, and the wizard exits to phase4-cleanup from
  // there — so this guard is briefly false between lab-prompt's Later
  // pick and the wizard's onComplete handler firing.
  if (!sidecar.wizard_completed_at && !sidecar.wizard_skipped_at) {
    return false;
  }
  return true;
}

export default function LabTourResumePrompt({
  username,
}: LabTourResumePromptProps) {
  const pathname = usePathname();
  const isInLabMode = pathname === "/lab" || pathname?.startsWith("/lab/");

  const [modalOpen, setModalOpen] = useState(false);
  const [uiState, setUiState] = useState<UiState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const prevInLabMode = useRef<boolean | null>(null);

  const evaluateAndMaybeFire = useCallback(async () => {
    try {
      const fresh = await readOnboarding(username);
      if (shouldShowPrompt(fresh)) {
        setModalOpen(true);
        setUiState("idle");
        setErrorMessage(null);
      }
    } catch (err) {
      console.error("[onboarding-v3] LabTourResumePrompt read failed", err);
    }
  }, [username]);

  useEffect(() => {
    const prev = prevInLabMode.current;
    prevInLabMode.current = isInLabMode ?? false;
    // First mount: prev is null. Don't fire — the user may have
    // already been in /lab when they picked Later, and L18 says we
    // wait for a re-entry. They have to leave and come back.
    if (prev === null) return;
    // Only fire on false → true transition.
    if (!isInLabMode || prev) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async I/O cycle (sidecar read); setState fires only after the await resolves, never synchronously during effect commit.
    void evaluateAndMaybeFire();
  }, [isInLabMode, evaluateAndMaybeFire]);

  const handleNow = useCallback(async () => {
    if (uiState === "persisting") return;
    setUiState("persisting");
    setErrorMessage(null);
    try {
      await patchOnboarding(username, (cur) => ({
        ...cur,
        lab_tour_pending: false,
        wizard_completed_at: null,
        wizard_skipped_at: null,
        wizard_force_show: true,
        wizard_resume_state: {
          current_step: "L1",
          skipped_steps: cur.wizard_resume_state?.skipped_steps ?? [],
          artifacts_created:
            cur.wizard_resume_state?.artifacts_created ?? [],
        },
      }));
      setModalOpen(false);
      setUiState("idle");
      // Reload so WizardMount's mount probe re-runs and picks up
      // wizard_force_show=true + the L1 resume step.
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (err) {
      console.error("[onboarding-v3] LabTourResumePrompt Now failed", err);
      setUiState("error");
      setErrorMessage("Couldn't start the tour. Try again or skip it.");
    }
  }, [uiState, username]);

  const handleSnooze = useCallback(() => {
    // Snooze leaves lab_tour_pending=true. The modal re-fires on the
    // next /lab transition (which means the user leaves /lab and
    // comes back — re-entries inside the same /lab visit don't
    // re-fire because the false→true transition guard only fires
    // once per round-trip).
    setModalOpen(false);
    setUiState("idle");
    setErrorMessage(null);
  }, []);

  const handleDismiss = useCallback(async () => {
    if (uiState === "persisting") return;
    setUiState("persisting");
    setErrorMessage(null);
    try {
      const dismissedAt = new Date().toISOString();
      await patchOnboarding(username, (cur) => ({
        ...cur,
        lab_tour_pending: false,
        lab_tour_dismissed_at: dismissedAt,
      }));
      setModalOpen(false);
      setUiState("idle");
    } catch (err) {
      console.error("[onboarding-v3] LabTourResumePrompt Dismiss failed", err);
      setUiState("error");
      setErrorMessage("Couldn't save that. Try again or click Snooze.");
    }
  }, [uiState, username]);

  if (!modalOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lab-tour-resume-title"
      data-lab-tour-prompt-state={uiState}
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
                id="lab-tour-resume-title"
                className="text-lg font-semibold text-gray-900"
              >
                Take the Lab tour now?
              </h2>
              <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                You saved this for later. Want to do the two-minute Lab
                Mode walkthrough now, snooze it for next time, or
                dismiss it for good?
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleNow()}
            disabled={uiState === "persisting"}
            data-lab-tour-prompt-action="now"
            className="px-4 py-3 text-sm font-medium rounded-lg border border-sky-500 bg-sky-500 text-white hover:bg-sky-600 transition-colors disabled:opacity-50 text-left"
          >
            <div className="font-semibold">Take Lab tour now</div>
            <div className="text-xs text-sky-50 mt-0.5">
              About two minutes. We&apos;ll pick up where you left off.
            </div>
          </button>
          <button
            type="button"
            onClick={() => handleSnooze()}
            disabled={uiState === "persisting"}
            data-lab-tour-prompt-action="snooze"
            className="px-4 py-3 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50 text-left"
          >
            <div className="font-semibold">Snooze</div>
            <div className="text-xs text-gray-600 mt-0.5">
              I&apos;ll ask again next time you open Lab Mode.
            </div>
          </button>
          <button
            type="button"
            onClick={() => void handleDismiss()}
            disabled={uiState === "persisting"}
            data-lab-tour-prompt-action="dismiss"
            className="px-4 py-3 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50 text-left"
          >
            <div className="font-semibold">Dismiss</div>
            <div className="text-xs text-gray-600 mt-0.5">
              Skip the tour for good. You can re-run from Settings any time.
            </div>
          </button>
          {errorMessage && (
            <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {errorMessage}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
