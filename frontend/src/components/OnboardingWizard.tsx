"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The Onboarding v2 7-step wizard component.
 *
 * Phase 1 lands the structural shell only: a portal-rendered modal
 * card with a step-indicator header, a stub body per step (Phase 2
 * fills the actual content), and a footer with Back / Continue +
 * a persistent Skip link. The component itself does NOT persist to
 * `_onboarding.json` or `settings.json`; the orchestrator passes
 * `onComplete` and `onSkip` callbacks and owns the writes. This
 * keeps the wizard testable in isolation and lets the orchestrator
 * also seed `mode: "suggestions"` in the same patch (Phase 1 brief).
 *
 * Step labels (used verbatim for the step title):
 *   1. Welcome to ResearchOS
 *   2. What brings you here?
 *   3. Tabs we'll show
 *   4. Connect Telegram?
 *   5. Add a calendar?
 *   6. AI Helper prompt?
 *   7. You're all set
 *
 * Phases 2-5 expand the body of each step into real UX (use-case
 * picker chips, tab-config preview, inline integration flows, etc.).
 * Phase 1's body is a single placeholder div per step.
 *
 * Visual register mirrors the v1 OnboardingWelcomeModal:
 *   - bg-black/30 backdrop-blur-sm overlay, z-[300]
 *   - white rounded-2xl shadow-2xl card with border-gray-200
 *   - p-7 padding, sky-500 primary buttons, gray-300 outlined
 *     secondary buttons
 *   - Card width pinned at 520px (within the 500-540 band specified
 *     in the Phase 1 brief)
 *
 * ARIA: role="dialog" + aria-modal="true" + aria-labelledby pointing
 * at the step title. Escape key triggers Skip (same handler as the
 * Skip link, by brief).
 */

const TOTAL_STEPS = 7;

const STEP_TITLES: Record<number, string> = {
  1: "Welcome to ResearchOS",
  2: "What brings you here?",
  3: "Tabs we'll show",
  4: "Connect Telegram?",
  5: "Add a calendar?",
  6: "AI Helper prompt?",
  7: "You're all set",
};

/** Internal step-name slugs used in the placeholder copy so a future
 *  reader can spot which Phase-2 surface owns each step. */
const STEP_SLUGS: Record<number, string> = {
  1: "welcome",
  2: "use-case picker",
  3: "tab config",
  4: "telegram",
  5: "calendar",
  6: "ai-helper",
  7: "all-set",
};

/** Container shape for per-step state collected as the user clicks
 *  through. Phase 1 only stubs `useCases`; Phase 2 adds the rest
 *  (visible tabs override, telegram-connected flag, calendar-source
 *  pick, ai-helper prompt seed). The orchestrator only sees the
 *  `useCases` value via `onComplete`; future step inputs land here
 *  before being surfaced through expanded callback signatures. */
interface WizardData {
  useCases: string[];
}

interface OnboardingWizardProps {
  /** Resolved username — passed through for any debug surface that
   *  may want to display it. The wizard component itself does NOT
   *  call patchOnboarding / patchUserSettings; the orchestrator owns
   *  those writes via the onComplete / onSkip callbacks. */
  username: string;
  /** Called on step-7 Continue ("Done"). The orchestrator should
   *  persist `use_cases`, `wizard_completed_at`, `visibleTabs`, and
   *  seed `mode: "suggestions"` if null. */
  onComplete: (useCases: string[]) => void;
  /** Called by the Skip link on any step AND by the Escape key
   *  (same handler, by brief). The orchestrator should persist
   *  `wizard_skipped_at` only (leave `use_cases` null per master's
   *  null-vs-empty-array distinction) and seed `mode: "suggestions"`
   *  if null. */
  onSkip: () => void;
}

export default function OnboardingWizard({
  username: _username,
  onComplete,
  onSkip,
}: OnboardingWizardProps) {
  const [mounted, setMounted] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>({ useCases: [] });

  // useId() gives a stable aria-labelledby target so multiple wizard
  // mounts in dev hot-reload don't collide on a hard-coded id.
  const titleId = useId();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only; flip mounted after the first client render.
    setMounted(true);
  }, []);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(1, s - 1));
  }, []);

  const handleContinue = useCallback(() => {
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((s) => Math.min(TOTAL_STEPS, s + 1));
      return;
    }
    // Step 7: Continue is Done. Surface the picks (still empty in
    // Phase 1 since the picker chips land in Phase 2) and let the
    // orchestrator persist.
    onComplete(wizardData.useCases);
  }, [currentStep, onComplete, wizardData.useCases]);

  // Escape key → Skip. Mirrors the Skip link (same handler), per brief.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onSkip]);

  // wizardData is mutated by per-step components in Phase 2 (e.g. the
  // use-case picker on step 2 calls a setter to push selected ids).
  // Surface a stable setter here so the Phase-2 work can drop into
  // the body slot without re-architecting state.
  const updateWizardData = useCallback(
    (patch: Partial<WizardData>) => {
      setWizardData((cur) => ({ ...cur, ...patch }));
    },
    [],
  );
  // Phase 1 does not invoke this; reference it once so the linter
  // doesn't flag the helper as unused while Phase 2 is pending.
  void updateWizardData;

  const progressPct = useMemo(
    () => Math.round((currentStep / TOTAL_STEPS) * 100),
    [currentStep],
  );

  if (!mounted) return null;

  const stepTitle = STEP_TITLES[currentStep] ?? "";
  const stepSlug = STEP_SLUGS[currentStep] ?? "";
  const isLastStep = currentStep === TOTAL_STEPS;
  const isFirstStep = currentStep === 1;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[520px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden">
        {/* Header: step indicator + step title + progress bar. */}
        <div className="px-7 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Step {currentStep} of {TOTAL_STEPS}
            </span>
          </div>
          <h2
            id={titleId}
            className="mt-1 text-xl font-semibold text-gray-900"
          >
            {stepTitle}
          </h2>
          {/* Thin progress bar filled to currentStep / TOTAL_STEPS. */}
          <div
            className="mt-3 h-1 w-full bg-gray-100 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={currentStep}
            aria-label={`Onboarding progress: step ${currentStep} of ${TOTAL_STEPS}`}
          >
            <div
              className="h-full bg-sky-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Body: per-step placeholder. Phase 2 fills these in. */}
        <div className="px-7 py-6">
          <div className="min-h-[200px] flex items-center justify-center text-center text-gray-500 text-sm leading-relaxed">
            Step {currentStep}: {stepSlug}, content lands in Phase 2.
          </div>
        </div>

        {/* Footer: Back (left), Skip link (center), Continue (right). */}
        <div className="px-7 pb-6 pt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={isFirstStep}
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Back
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Skip setup
          </button>

          <button
            type="button"
            onClick={handleContinue}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            {isLastStep ? "Done" : "Continue"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
