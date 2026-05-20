"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot from "@/components/BeakerBot";
import {
  getNextStep,
  getPreviousStep,
  stepIndex,
  stepCreatesPrerequisite,
  totalSteps,
  type WizardStep,
} from "./WizardStepMachine";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import WelcomeStep from "./steps/setup/WelcomeStep";
import Q1AccountTypeStep from "./steps/setup/Q1AccountTypeStep";
import Q1aLabStorageStep from "./steps/setup/Q1aLabStorageStep";
import Q1bLabConnectInfoStep from "./steps/setup/Q1bLabConnectInfoStep";
import Q2PurchasesStep from "./steps/setup/Q2PurchasesStep";
import Q3CalendarStep from "./steps/setup/Q3CalendarStep";
import Q4GoalsStep from "./steps/setup/Q4GoalsStep";
import Q5TelegramStep from "./steps/setup/Q5TelegramStep";
import Q6AiHelperStep from "./steps/setup/Q6AiHelperStep";
import { initialFeaturePicks } from "./steps/setup/feature-picks-init";

/**
 * The Onboarding v3 wizard shell.
 *
 * P1 owns: modal frame, focus trap, BeakerBot mascot slot, step
 * indicator, Next / Back / Skip-this-step / I've-got-it-from-here
 * footer wiring, and the placeholder step body switch. P2a/b/c and
 * P3a will fill in the real step bodies via `<StepBody>` cases; for
 * P1 every step except "intro" renders a placeholder div per the
 * brief.
 *
 * No animation polish: BeakerBot renders in its idle pose, no idle
 * bob, no attention pulse, no live-typing demos. Those are P9.
 *
 * Persistence contract: the wizard fires three callbacks to its
 * parent (WizardMount):
 *   - `onTransition(step)` — fires on Next / Back / Skip-this-step.
 *     The parent persists `wizard_resume_state.current_step = step`
 *     to the sidecar so a tab close mid-flow can resume in P5. The
 *     wizard awaits the parent's persistence promise so a close
 *     event mid-write doesn't drop the snapshot.
 *   - `onComplete()` — fires when the user finishes phase4-cleanup.
 *     The parent writes wizard_completed_at, clears resume state,
 *     and unmounts the wizard.
 *   - `onSkip()` — fires when the user confirms the "I've got it from
 *     here" link (jumps to phase4-cleanup). For P1, also fires when
 *     the user clicks Finish on the cleanup placeholder; P4 will
 *     ship the real cleanup grid with its own completion path.
 *
 * Accessibility: role=dialog + aria-modal + aria-labelledby pointing
 * at the step title. Tab/Shift+Tab cycles inside the modal; focus
 * restores on unmount. Escape does NOT skip the wizard (different
 * from v2 — the new persistent footer "I've got it from here" link
 * is the only declarative exit, per L8).
 */

interface OnboardingWizardV3Props {
  /** Active username — passed to the placeholder step bodies for
   *  future P2a/b/c persistence wiring. */
  username: string;
  /** Initial step. WizardMount supplies this from
   *  `wizard_resume_state.current_step` when resuming, or `"intro"`
   *  on a fresh fire. */
  initialStep: WizardStep;
  /** Read-only sidecar snapshot for gate evaluation. The wizard
   *  recomputes step index / total / next-step on every render; the
   *  parent passes the latest sidecar so the gate sees the writes
   *  the step bodies will eventually make (P2a will persist
   *  feature_picks as Q1-Q6 are answered). */
  sidecar: OnboardingSidecar | null;
  /** Persistence hook fired on every Next / Back / Skip-this-step.
   *  Returns a promise the wizard awaits before transitioning the
   *  UI; this preserves the L10 invariant that a tab close
   *  mid-write doesn't drop the snapshot. */
  onTransition: (next: WizardStep) => Promise<void>;
  /** Generic sidecar patcher fired by Phase 1 step bodies to persist
   *  feature_picks (and any other field a future step body needs to
   *  write). The wizard threads this to each step component; WizardMount
   *  wraps `patchOnboarding` and rolls the returned sidecar into its
   *  decision state so the next render sees the writes. */
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
  /** Fires on phase4-cleanup completion (P1: also fires when the
   *  user clicks Finish on the placeholder cleanup step). The parent
   *  writes wizard_completed_at and clears resume state. */
  onComplete: () => Promise<void>;
  /** Fires when the user confirms the "I've got it from here"
   *  jump-to-cleanup affordance (L8 lock). The parent writes
   *  wizard_skipped_at and clears resume state. */
  onSkip: () => Promise<void>;
  /** Dev / testing preview-mode flag. When true, the wizard renders
   *  a small amber "Preview mode" banner above the step header so
   *  testing agents can confirm at a glance no real data was
   *  persisted by this run. */
  previewMode?: boolean;
}

function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      const nodes = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      return Array.from(nodes).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    };

    const initial = window.setTimeout(() => {
      const first = getFocusable()[0];
      if (first) first.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = getFocusable();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }
      if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(initial);
      container.removeEventListener("keydown", onKey);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try {
          previouslyFocused.focus();
        } catch {
          // ignore — some elements refuse focus
        }
      }
    };
  }, [active, containerRef]);
}

type UiState = "idle" | "persisting" | "navigating" | "error";

export default function OnboardingWizardV3({
  username,
  initialStep,
  sidecar,
  onTransition,
  patchSidecar,
  onComplete,
  onSkip,
  previewMode = false,
}: OnboardingWizardV3Props) {
  const [mounted, setMounted] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>(initialStep);
  const [uiState, setUiState] = useState<UiState>("idle");
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  // Setup-step Next-button gate. The step body calls setNextDisabled to
  // control whether the shell's Next button is clickable; required for
  // Q1-Q5 where Next is disabled until the user makes a pick.
  const [nextDisabled, setNextDisabled] = useState(false);

  const titleId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);

  // feature_picks live on the sidecar in P2a+; P1 reads them through
  // sidecar.feature_picks. The intro step before Q1 has picks=null,
  // which the state machine treats as "lab gates closed", so a fresh
  // user walks the solo path until they confirm Q1=lab.
  const picks: FeaturePicks | null = sidecar?.feature_picks ?? null;

  const total = useMemo(
    () => totalSteps(sidecar, picks),
    [sidecar, picks],
  );
  const idx = useMemo(
    () => stepIndex(currentStep, sidecar, picks),
    [currentStep, sidecar, picks],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only; flip mounted after the first client render.
    setMounted(true);
  }, []);

  useFocusTrap(mounted, cardRef);

  const transitionTo = useCallback(
    async (next: WizardStep) => {
      setUiState("navigating");
      try {
        await onTransition(next);
        setCurrentStep(next);
        setUiState("idle");
      } catch (err) {
        console.error("[onboarding-v3] transition persistence failed", err);
        setUiState("error");
      }
    },
    [onTransition],
  );

  const handleNext = useCallback(async () => {
    if (currentStep === "phase4-cleanup") {
      setUiState("persisting");
      try {
        await onComplete();
        setUiState("idle");
      } catch (err) {
        console.error("[onboarding-v3] onComplete failed", err);
        setUiState("error");
      }
      return;
    }
    const next = getNextStep(currentStep, sidecar, picks);
    if (!next) return;
    await transitionTo(next);
  }, [currentStep, sidecar, picks, onComplete, transitionTo]);

  const handleBack = useCallback(async () => {
    const prev = getPreviousStep(currentStep, sidecar, picks);
    if (!prev) return;
    await transitionTo(prev);
  }, [currentStep, sidecar, picks, transitionTo]);

  const handleSkipThisStep = useCallback(async () => {
    // L9: skip the current step. If the step creates a prerequisite,
    // P2b will silently auto-create it; for P1 we just log the id and
    // advance. The placeholder bodies don't create real artifacts yet
    // so the log is informational.
    if (stepCreatesPrerequisite(currentStep)) {
      // TODO P2b: auto-create prerequisite for skipped step
    }
    // For Phase 1 setup steps, skipping = falling through with the
    // field's default. Manager lock (P2a brief): Q1 defaults to solo
    // (the lighter branch; lab would force the user into Q1a + Q1b they
    // didn't explicitly opt into). Q1a defaults to lab_storage=deferred.
    // Q2-Q5 and Q6 already carry their defaults via initialFeaturePicks,
    // but writing them explicitly here keeps the skip a single
    // idempotent persistence call regardless of prior state.
    //
    // We also append the skipped step id to
    // `wizard_resume_state.skipped_steps` in the same patch so P5's
    // Resume modal can surface the list and P4's cleanup grid can tag
    // auto-created prerequisites as "skipped, auto-created". The
    // append is idempotent: a state-machine corner case that re-fires
    // skip on the same step id will not duplicate the entry. The
    // lab_tour_decision: sentinel scheme P1 wrote into the same array
    // remains untouched: real step ids (e.g. "setup-q2", "W5") never
    // start with that prefix.
    await patchSidecar((cur) => {
      const featurePicksPatched = applyFeaturePicksDefault(cur, currentStep);
      const existingResume = featurePicksPatched.wizard_resume_state ?? {
        current_step: currentStep,
        skipped_steps: [],
        artifacts_created: [],
      };
      if (existingResume.skipped_steps.includes(currentStep)) {
        return featurePicksPatched;
      }
      return {
        ...featurePicksPatched,
        wizard_resume_state: {
          ...existingResume,
          skipped_steps: [...existingResume.skipped_steps, currentStep],
        },
      };
    });
    const next = getNextStep(currentStep, sidecar, picks);
    if (!next) return;
    await transitionTo(next);
  }, [currentStep, sidecar, picks, patchSidecar, transitionTo]);

  const handleGotItConfirm = useCallback(async () => {
    setShowSkipConfirm(false);
    setUiState("persisting");
    try {
      await onSkip();
      setUiState("idle");
    } catch (err) {
      console.error("[onboarding-v3] onSkip failed", err);
      setUiState("error");
    }
  }, [onSkip]);

  if (!mounted) return null;

  const isFirstStep = idx <= 1;
  const isCleanupStep = currentStep === "phase4-cleanup";
  const progressPct = total > 0 ? Math.round((idx / total) * 100) : 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-wizard-root="v3"
      data-wizard-state={uiState}
      data-wizard-step={currentStep}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div
        ref={cardRef}
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[560px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden"
      >
        {previewMode && (
          <div className="px-7 pt-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
              Preview mode, no data written.
            </div>
          </div>
        )}

        <div className="px-7 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex-shrink-0"
              style={{ width: 80, height: 80 }}
            >
              <BeakerBot
                pose="waving"
                direction="right"
                className="w-full h-full text-sky-500"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {total > 0 ? `Step ${idx} of ${total}` : "Step"}
                </span>
                <span className="text-[10px] font-mono text-gray-400">
                  {currentStep}
                </span>
              </div>
              <h2
                id={titleId}
                className="mt-1 text-xl font-semibold text-gray-900"
              >
                {stepTitle(currentStep)}
              </h2>
              <div
                className="mt-3 h-1 w-full bg-gray-100 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={idx}
                aria-label={`Onboarding progress: step ${idx} of ${total}`}
              >
                <div
                  className="h-full bg-sky-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-7 py-6">
          <StepBody
            key={currentStep}
            step={currentStep}
            username={username}
            sidecar={sidecar}
            setNextDisabled={setNextDisabled}
            patchSidecar={patchSidecar}
          />
        </div>

        <div className="px-7 pb-4 pt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleBack()}
            disabled={isFirstStep || uiState === "navigating"}
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Back
          </button>

          {!isCleanupStep && currentStep !== "intro" && (
            <button
              type="button"
              onClick={() => void handleSkipThisStep()}
              disabled={uiState === "navigating"}
              className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-40"
            >
              Skip this step
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={
              nextDisabled ||
              uiState === "navigating" ||
              uiState === "persisting"
            }
            data-wizard-state={uiState}
            data-next-disabled={nextDisabled ? "true" : "false"}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {nextButtonLabel(currentStep, uiState)}
          </button>
        </div>

        <div className="px-7 pb-4 border-t border-gray-100 pt-3 text-center">
          <button
            type="button"
            onClick={() => setShowSkipConfirm(true)}
            disabled={uiState === "persisting"}
            className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-40"
          >
            I&apos;ve got it from here
          </button>
        </div>
      </div>

      {showSkipConfirm && (
        <SkipConfirmModal
          onCancel={() => setShowSkipConfirm(false)}
          onConfirm={() => void handleGotItConfirm()}
        />
      )}
    </div>,
    document.body,
  );
}

/** Apply the Phase 1 Skip-this-step default for the field owned by
 *  `step`. Returns the sidecar unchanged for non-setup steps (W*, L*,
 *  phase4-cleanup); those steps have no feature_picks field to
 *  default. Pulled out of `handleSkipThisStep` so the skipped-step
 *  log append can compose with the feature_picks write in a single
 *  patch call. */
function applyFeaturePicksDefault(
  cur: OnboardingSidecar,
  step: WizardStep,
): OnboardingSidecar {
  switch (step) {
    case "setup-q1": {
      const base = cur.feature_picks ?? initialFeaturePicks("solo");
      return {
        ...cur,
        feature_picks: { ...base, account_type: "solo" },
      };
    }
    case "setup-q1a": {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: {
          ...cur.feature_picks,
          lab_storage: "deferred",
        },
      };
    }
    case "setup-q2": {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, purchases: "maybe" },
      };
    }
    case "setup-q3": {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, calendar: "maybe" },
      };
    }
    case "setup-q4": {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, goals: "maybe" },
      };
    }
    case "setup-q5": {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, telegram: "maybe" },
      };
    }
    case "setup-q6": {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, ai_helper: "full" },
      };
    }
    default:
      return cur;
  }
}

function nextButtonLabel(step: WizardStep, uiState: UiState): string {
  if (uiState === "navigating") return "Saving...";
  if (uiState === "persisting") return "Saving...";
  if (step === "phase4-cleanup") return "Finish setup";
  if (step === "intro") return "Let's go";
  return "Next";
}

function stepTitle(step: WizardStep): string {
  switch (step) {
    case "intro":
      return "Welcome to ResearchOS";
    case "setup-q1":
      return "Solo or lab?";
    case "setup-q1a":
      return "Where will lab data live?";
    case "setup-q1b":
      return "How lab members connect";
    case "setup-q2":
      return "Track lab purchases?";
    case "setup-q3":
      return "Want calendar feeds?";
    case "setup-q4":
      return "Want a goal-tracking page?";
    case "setup-q5":
      return "Telegram for image inbox?";
    case "setup-q6":
      return "AI Helper prompt?";
    case "W1":
      return "Create your first project";
    case "W2":
      return "Add a method";
    case "W3":
      return "Create your first experiment";
    case "W4":
      return "Link the method";
    case "W5":
      return "Hybrid editor tour";
    case "W6":
      return "Personalize the look";
    case "W7":
      return "Search tour";
    case "W8":
      return "Notifications tour";
    case "W9":
      return "Where to find help";
    case "W10":
      return "Purchases tour";
    case "W11":
      return "Goals tour";
    case "W12":
      return "Telegram tour";
    case "W13":
      return "Calendar tour";
    case "W14":
      return "AI Helper tour";
    case "lab-prompt":
      return "Tour Lab Mode now?";
    case "L1":
      return "What Lab Mode is";
    case "L2":
      return "Meet BeakerBot, your lab partner";
    case "L3":
      return "See a shared task";
    case "L4":
      return "Permission practice";
    case "L5":
      return "Share something back";
    case "L6":
      return "Revoke sharing";
    case "L7":
      return "Lab Gantt and activity";
    case "L8":
      return "Lab purchases";
    case "L9":
      return "Lab search";
    case "L10":
      return "Lab Mode wrap";
    case "L11":
      return "Clean up the demo lab?";
    case "phase4-cleanup":
      return "Keep what we made?";
    default:
      return "";
  }
}

/** Step body dispatcher. P2a fills in the real bodies for the 9 Phase 1
 *  setup steps (intro + setup-q1 + setup-q1a + setup-q1b + setup-q2
 *  through setup-q6); W1-W14, L1-L11, and phase4-cleanup remain
 *  placeholders for P2b/c, P3a, and P4 to swap in. */
function StepBody({
  step,
  username: _username,
  sidecar,
  setNextDisabled,
  patchSidecar,
}: {
  step: WizardStep;
  username: string;
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}) {
  switch (step) {
    case "intro":
      return <WelcomeStep setNextDisabled={setNextDisabled} />;
    case "setup-q1":
      return (
        <Q1AccountTypeStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "setup-q1a":
      return (
        <Q1aLabStorageStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "setup-q1b":
      return <Q1bLabConnectInfoStep setNextDisabled={setNextDisabled} />;
    case "setup-q2":
      return (
        <Q2PurchasesStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "setup-q3":
      return (
        <Q3CalendarStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "setup-q4":
      return (
        <Q4GoalsStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "setup-q5":
      return (
        <Q5TelegramStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "setup-q6":
      return (
        <Q6AiHelperStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    default:
      return (
        <PlaceholderBody
          step={step}
          setNextDisabled={setNextDisabled}
        />
      );
  }
}

function PlaceholderBody({
  step,
  setNextDisabled,
}: {
  step: WizardStep;
  setNextDisabled: (disabled: boolean) => void;
}) {
  // P2b/c, P3a, P4 land the real bodies. Placeholders keep Next enabled
  // so the smoke test still walks the step graph end-to-end.
  useEffect(() => {
    setNextDisabled(false);
  }, [setNextDisabled]);
  return (
    <div className="space-y-2 min-h-[120px]">
      <p className="text-sm text-gray-600">
        Step <span className="font-mono">{step}</span> placeholder. The
        real body lands in a later phase.
      </p>
      <p className="text-xs text-gray-400">
        P1 wires the step order and persistence; the W1 / W2 / L4 bodies
        themselves are P2a / P2b / P3a.
      </p>
    </div>
  );
}

function SkipConfirmModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Skip to cleanup selector"
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[420px] max-w-[calc(100vw-2rem)] mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900">
          Skip to the cleanup selector?
        </h3>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">
          You can review everything we made and keep or discard each item.
        </p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm"
          >
            Yes, skip ahead
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
