"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import { TOUR_STEP_ORDER } from "./step-machine";
import { useTourController } from "./TourController";

/**
 * Onboarding v4 P11 bootstrap. Sits inside `<TourControllerProvider>`
 * and decides what the tour should do on first mount for the active
 * user:
 *
 *   1. Fresh user (no `wizard_completed_at` AND no `wizard_skipped_at`
 *      AND no `wizard_resume_state`): call `controller.start()` so the
 *      tour begins at the first applicable step.
 *   2. Mid-v4 resume (`wizard_resume_state.current_step` is a v4 step
 *      id, ie in `TOUR_STEP_ORDER`): call `controller.start(resumeId)`
 *      to land back on the saved step.
 *   3. v3-in-flight (`wizard_resume_state.current_step` is NOT a v4
 *      step id): render a one-time prompt asking the user to restart
 *      on v4 or skip wholesale.
 *   4. Completed / skipped: no-op.
 *
 * The mid-tour-resume case respects `feature_picks` already on the
 * sidecar because the TourController seeded its `featurePicks` slot via
 * `initialFeaturePicks` at provider mount. The gating machine consults
 * that for every step transition, so resuming at, say,
 * `home-create-project` for a solo user just works.
 *
 * The component renders nothing on the happy paths (start / no-op);
 * only the v3-in-flight prompt path renders DOM. Bypasses on the dev
 * `?wizard-preview=1` query, where the dev hook always force-starts the
 * tour at the first step so screenshots / wiki captures work
 * regardless of the user's sidecar state.
 */

interface TourBootstrapProps {
  username: string;
}

type BootstrapState =
  | { kind: "probing" }
  | { kind: "resolved" }
  | { kind: "v3-inflight"; sidecar: OnboardingSidecar };

export default function TourBootstrap({ username }: TourBootstrapProps) {
  const searchParams = useSearchParams();
  const previewMode = searchParams?.get("wizard-preview") === "1";
  const controller = useTourController();
  const [state, setState] = useState<BootstrapState>({ kind: "probing" });

  // One-shot bootstrap. The decision is taken on first mount per user
  // session; subsequent renders (state flips, controller advances) do
  // not re-fire the probe so we never re-summon the prompt mid-tour.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sidecar = await readOnboarding(username);
        if (cancelled) return;

        if (previewMode) {
          // Dev hook (parallels v3's WizardMount). Always start at
          // the first applicable step so wiki screenshots + manual
          // tests don't have to wipe sidecars.
          controller.start();
          setState({ kind: "resolved" });
          return;
        }

        // Completed / skipped: do nothing. Settings re-run is the
        // only way back in.
        if (sidecar.wizard_completed_at || sidecar.wizard_skipped_at) {
          setState({ kind: "resolved" });
          return;
        }

        const resumeId = sidecar.wizard_resume_state?.current_step ?? null;
        if (resumeId) {
          if (isV4StepId(resumeId)) {
            controller.start(resumeId);
            setState({ kind: "resolved" });
            return;
          }
          // v3-in-flight: surface the prompt before auto-starting v4
          // so the user gets a chance to opt out cleanly.
          setState({ kind: "v3-inflight", sidecar });
          return;
        }

        // Fresh user (no completion, no skip, no resume state) ->
        // kick off v4 at the first applicable step.
        controller.start();
        setState({ kind: "resolved" });
      } catch (err) {
        console.error("[onboarding-v4] bootstrap probe failed", err);
        if (!cancelled) setState({ kind: "resolved" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only on username + previewMode. The controller
    // identity is stable across renders and we don't want a re-probe
    // when start() flips currentStep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, previewMode]);

  const handleRestart = useCallback(async () => {
    try {
      await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_resume_state: null,
      }));
    } catch (err) {
      console.error("[onboarding-v4] v3-inflight restart patch failed", err);
    }
    controller.start();
    setState({ kind: "resolved" });
  }, [username, controller]);

  const handleSkip = useCallback(async () => {
    try {
      await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_skipped_at: new Date().toISOString(),
        wizard_force_show: false,
        wizard_resume_state: null,
      }));
    } catch (err) {
      console.error("[onboarding-v4] v3-inflight skip patch failed", err);
    }
    setState({ kind: "resolved" });
  }, [username]);

  if (state.kind !== "v3-inflight") return null;

  return (
    <V3InflightPrompt onRestart={handleRestart} onSkip={handleSkip} />
  );
}

const V4_STEP_SET: ReadonlySet<string> = new Set(TOUR_STEP_ORDER);

/** True when the step id belongs to v4's step graph. v3 step ids
 *  ("intro", "W3", "L4" etc.) return false and trigger the v3-inflight
 *  prompt. */
export function isV4StepId(stepId: string): boolean {
  return V4_STEP_SET.has(stepId);
}

interface V3InflightPromptProps {
  onRestart: () => void;
  onSkip: () => void;
}

/**
 * One-shot modal for users who had a v3 walkthrough in flight (a non-v4
 * `wizard_resume_state.current_step`) at the moment v4 activates. Two
 * buttons:
 *
 *   - Restart: clears `wizard_resume_state`, calls
 *     `controller.start()` so v4 begins at the welcome step.
 *   - Skip: writes `wizard_skipped_at`, clears `wizard_resume_state`.
 *     Settings re-run still works because it clears that field.
 *
 * The modal mirrors v3's `WizardResumeModal` chrome (BeakerBot header,
 * centered card, primary + secondary buttons) so the user's visual
 * vocabulary stays consistent across the v3 -> v4 cutover.
 */
function V3InflightPrompt({ onRestart, onSkip }: V3InflightPromptProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only.
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour updated"
      data-testid="v3-inflight-prompt"
      className="fixed inset-0 z-[350] flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[480px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden">
        <div className="px-7 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex-shrink-0"
              style={{ width: 96, height: 96 }}
            >
              <BeakerBot
                pose="waving"
                direction="right"
                className="w-full h-full text-sky-500"
              />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Heads up
              </span>
              <h2 className="mt-1 text-xl font-semibold text-gray-900">
                Welcome tour updated
              </h2>
            </div>
          </div>
        </div>

        <div className="px-7 py-6 text-sm text-gray-700 leading-relaxed">
          <p>
            We refreshed the welcome tour. You had some progress on the
            old version. Want to start the new one, or skip and keep
            what you have?
          </p>
        </div>

        <div className="px-7 pb-5 pt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onSkip}
            data-testid="v3-inflight-skip"
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onRestart}
            data-testid="v3-inflight-restart"
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            Restart
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
