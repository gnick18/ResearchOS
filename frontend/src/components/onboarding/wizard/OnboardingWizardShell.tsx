"use client";

// Shared stepper shell for the onboarding wizard (the 3-track account-setup
// flow). This component owns the chrome only: the progress indicator, the
// persistent Back button, the Skip link (where the active step allows it), and a
// visible close that drops the user to a safe state. The step content is
// supplied by the track via each step's render function (wizard-model.ts).
//
// No hard-traps: every state past the first step has a Back, and every state has
// a close. The first step has only the close (which the host wires to a safe
// landing). The progress counter is hidden for single-step tracks per the spec.
//
// The shell is purely additive and is mounted only behind
// NEXT_PUBLIC_ONBOARDING_WIZARD. It carries no navigation of its own beyond the
// reducer; finishing and closing are handed back to the host.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useMemo, useReducer, useEffect } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import LandingBackdrop from "@/components/onboarding/oauth-first/LandingBackdrop";
import {
  initWizardNav,
  wizardNavReducer,
  wizardProgress,
  type WizardTrack,
  type WizardStepControls,
} from "./wizard-model";

export interface OnboardingWizardShellProps {
  /** The active track (ordered steps). */
  track: WizardTrack;
  /**
   * Called once the user advances past the last step. The host provisions and
   * routes to the finished destination (the app, the lab workspace, or the org
   * portal).
   */
  onFinish: () => void;
  /**
   * Called when the user closes the wizard before finishing. The host drops the
   * user to a safe landing (local-only landing for research tracks, the org
   * portal landing for org tracks). Never a hard-trap.
   */
  onClose: () => void;
}

export default function OnboardingWizardShell({
  track,
  onFinish,
  onClose,
}: OnboardingWizardShellProps) {
  const total = track.steps.length;
  const [nav, dispatch] = useReducer(
    (state: ReturnType<typeof initWizardNav>, action: Parameters<typeof wizardNavReducer>[1]) =>
      wizardNavReducer(state, action, total),
    undefined,
    initWizardNav,
  );

  // Terminal transitions are handled in an effect so the host's side effects
  // (routing, provisioning) run after render, not during dispatch.
  useEffect(() => {
    if (nav.done) onFinish();
  }, [nav.done, onFinish]);
  useEffect(() => {
    if (nav.closed) onClose();
  }, [nav.closed, onClose]);

  const next = useCallback(() => dispatch({ type: "next" }), []);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const skip = useCallback(() => dispatch({ type: "skip" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);

  const step = track.steps[Math.min(nav.index, total - 1)];
  const isFirst = nav.index === 0;
  const progress = wizardProgress(nav.index, total);

  const controls: WizardStepControls = useMemo(
    () => ({
      next,
      back,
      skip,
      close,
      index: nav.index,
      total,
    }),
    [next, back, skip, close, nav.index, total],
  );

  // Once terminal, render nothing (the host is routing away).
  if (nav.done || nav.closed || !step) return null;

  return (
    <div
      className="light-scope relative isolate flex min-h-screen w-full flex-col bg-white text-foreground"
      data-testid="onboarding-wizard-shell"
    >
      <div className="pointer-events-none absolute inset-0 -z-10">
        <LandingBackdrop />
      </div>

      {/* Top chrome: progress + close. */}
      <div className="relative z-10 flex items-center justify-between gap-4 px-6 pt-6">
        {/* Progress indicator (segmented dots + labelled counter), hidden for
            single-step tracks. */}
        {progress.showCounter ? (
          <div
            className="flex items-center gap-3"
            data-testid="wizard-progress"
            aria-label={`Step ${progress.current} of ${progress.total}`}
          >
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {track.steps.map((s, i) => (
                <span
                  key={s.id}
                  data-testid={`wizard-dot-${i}`}
                  data-active={i === nav.index ? "true" : "false"}
                  data-complete={i < nav.index ? "true" : "false"}
                  className={[
                    "h-2 rounded-full transition-all",
                    i === nav.index
                      ? "w-6 bg-[#1283c9]"
                      : i < nav.index
                        ? "w-2 bg-[#1283c9]/60"
                        : "w-2 bg-border",
                  ].join(" ")}
                />
              ))}
            </div>
            <span className="text-meta font-semibold text-foreground-muted">
              {track.label}
              <span className="mx-1.5 opacity-40">/</span>
              {step.label}
            </span>
          </div>
        ) : (
          <span className="text-meta font-semibold text-foreground-muted">
            {track.label}
          </span>
        )}

        {/* Visible close, reachable from every state. */}
        <Tooltip label="Close setup">
          <button
            type="button"
            onClick={close}
            aria-label="Close setup"
            data-testid="wizard-close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1283c9]"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      {/* Step body. */}
      <div
        className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-8"
        data-testid="wizard-step-body"
        data-step-id={step.id}
      >
        <div className="w-full">{step.render(controls)}</div>
      </div>

      {/* Bottom chrome: Back (every step but the first) + Skip (where allowed). */}
      <div className="relative z-10 flex items-center justify-between gap-4 px-6 pb-8">
        <div>
          {!isFirst && (
            <button
              type="button"
              onClick={back}
              data-testid="wizard-back"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-body font-semibold text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1283c9]"
            >
              <Icon name="chevronLeft" className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
          )}
        </div>
        <div>
          {step.skippable && (
            <button
              type="button"
              onClick={skip}
              data-testid="wizard-skip"
              className="rounded-lg px-3 py-2 text-body font-semibold text-foreground-muted underline underline-offset-2 transition-colors hover:text-foreground hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1283c9]"
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
