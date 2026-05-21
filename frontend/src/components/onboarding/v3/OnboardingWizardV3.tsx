"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
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
import W1CreateProjectStep from "./steps/walkthrough/W1CreateProjectStep";
import W2CreateMethodStep from "./steps/walkthrough/W2CreateMethodStep";
import W3CreateExperimentStep from "./steps/walkthrough/W3CreateExperimentStep";
import W4LinkMethodStep from "./steps/walkthrough/W4LinkMethodStep";
import W5HybridEditorTourStep from "./steps/walkthrough/W5HybridEditorTourStep";
import W6PersonalizationStep from "./steps/walkthrough/W6PersonalizationStep";
import W7SearchTourStep from "./steps/walkthrough/W7SearchTourStep";
import W8NotificationsTourStep from "./steps/walkthrough/W8NotificationsTourStep";
import W9WikiPointerStep from "./steps/walkthrough/W9WikiPointerStep";
import W10PurchasesTourStep from "./steps/walkthrough/W10PurchasesTourStep";
import W11GoalsTourStep from "./steps/walkthrough/W11GoalsTourStep";
import W12TelegramWithImageStep from "./steps/walkthrough/W12TelegramWithImageStep";
import W13CalendarTourStep from "./steps/walkthrough/W13CalendarTourStep";
import W14AiHelperStep from "./steps/walkthrough/W14AiHelperStep";
import LabPromptStep from "./steps/lab/LabPromptStep";
import L1WhatIsLabMode from "./steps/lab/L1WhatIsLabMode";
import L2SpawnFakeBeakerBot from "./steps/lab/L2SpawnFakeBeakerBot";
import L3SeeBeakerBotTask from "./steps/lab/L3SeeBeakerBotTask";
import L4PermissionPractice from "./steps/lab/L4PermissionPractice";
import L5UserSharesBack from "./steps/lab/L5UserSharesBack";
import L6RevokeShare from "./steps/lab/L6RevokeShare";
import L7GanttAndActivityFeed from "./steps/lab/L7GanttAndActivityFeed";
import L8LabPurchases from "./steps/lab/L8LabPurchases";
import L9LabSearch from "./steps/lab/L9LabSearch";
import L10LabWrap from "./steps/lab/L10LabWrap";
import L11BeakerBotCleanupOption from "./steps/lab/L11BeakerBotCleanupOption";
import Phase4CleanupStep, {
  artifactKey,
} from "./steps/cleanup/Phase4CleanupStep";
import { cleanupArtifacts } from "./steps/cleanup/cleanup-execution";

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
 * BeakerBot pose mechanism: P9 lands the 7-pose menu (idle-bob,
 * wave, point, bounce, type, think, celebrate, bow-wink). The shell
 * computes a resting pose per step (see restingPoseForStep below)
 * and layers a bouncing burst on each step transition. Idle bob is
 * the always-on baseline when no other pose applies; the mascot's
 * own component honors `prefers-reduced-motion`.
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
  // P9 BeakerBot pose mechanism. `isBouncing` flips true for ~650ms
  // after each successful step transition so the mascot acknowledges
  // the Next click with a bounce burst before settling into the new
  // step's resting pose. See restingPoseForStep below for the
  // per-step pose map (welcome=wave, Q1-Q6=think, W*/L*=point,
  // W5/W7=type, phase4-cleanup=celebrate). The very-final pose
  // (bow-wink) fires while uiState is "persisting" on phase4-cleanup
  // (i.e. Finish has been clicked and the parent is about to unmount).
  const [isBouncing, setIsBouncing] = useState(false);
  // P4 cleanup-grid state lifted into the shell so handleNext can read
  // the user's keep/discard picks at Finish-click time. Keys are
  // `${artifact.type}:${artifact.id}` (see steps/cleanup/Phase4CleanupStep
  // artifactKey helper). Initialized lazily on first render at the
  // cleanup step from each artifact's cleanup_default (L24 default-keep
  // + L9 auto-prerequisite discard-by-default + L11 lab-cleanup pick).
  const [cleanupDecisions, setCleanupDecisions] = useState<
    Record<string, "keep" | "discard">
  >({});
  // P4 routing flag: flips true when the user confirms the persistent
  // "I've got it from here" link (L8). The cleanup step still renders
  // and the user picks keep/discard normally; on Finish the shell calls
  // `onSkip` (writes wizard_skipped_at) instead of `onComplete` (writes
  // wizard_completed_at). Sticky for the session: a back-step out of the
  // cleanup grid does not undo the user's expressed intent to skip.
  const [enteredCleanupViaSkip, setEnteredCleanupViaSkip] = useState(false);

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
        // Fire the bounce-burst pose on each successful step move. The
        // effect below clears it after ~650ms (matches the
        // beakerBotBounce keyframe duration).
        setIsBouncing(true);
      } catch (err) {
        console.error("[onboarding-v3] transition persistence failed", err);
        setUiState("error");
      }
    },
    [onTransition],
  );

  useEffect(() => {
    if (!isBouncing) return;
    const t = window.setTimeout(() => setIsBouncing(false), 650);
    return () => window.clearTimeout(t);
  }, [isBouncing]);

  // Seed cleanup decisions from each artifact's cleanup_default the
  // first time the cleanup step renders (and any time new artifacts
  // appear in the sidecar, e.g. a back-step + forward through a W-step
  // that wrote a new artifact). Existing keys are preserved so user
  // checkbox toggles survive re-seeding.
  useEffect(() => {
    if (currentStep !== "phase4-cleanup") return;
    const artifacts = sidecar?.wizard_resume_state?.artifacts_created ?? [];
    if (artifacts.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging the sidecar's persisted artifact list into the wizard shell's cleanup-decision map; functional setState with a no-op return when nothing changes makes the cascading-render warning a false positive here.
    setCleanupDecisions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const a of artifacts) {
        const key = `${a.type}:${a.id}`;
        if (next[key] === undefined) {
          next[key] = a.cleanup_default;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentStep, sidecar]);

  const handleNext = useCallback(async () => {
    if (currentStep === "phase4-cleanup") {
      setUiState("persisting");
      try {
        const artifacts =
          sidecar?.wizard_resume_state?.artifacts_created ?? [];
        const discarded = artifacts.filter(
          (a) => cleanupDecisions[artifactKey(a)] === "discard",
        );
        if (discarded.length > 0) {
          await cleanupArtifacts(discarded, username);
        }
        // The "I've got it from here" link routes through the cleanup
        // grid (L8 carry-forward) but is still a skip; record it as
        // wizard_skipped_at so the gate logic in §11 treats a re-open
        // the same way a non-cleanup skip would.
        if (enteredCleanupViaSkip) {
          await onSkip();
        } else {
          await onComplete();
        }
        setUiState("idle");
      } catch (err) {
        console.error("[onboarding-v3] cleanup finalize failed", err);
        setUiState("error");
      }
      return;
    }
    const next = getNextStep(currentStep, sidecar, picks);
    if (!next) return;
    await transitionTo(next);
  }, [
    currentStep,
    sidecar,
    picks,
    cleanupDecisions,
    enteredCleanupViaSkip,
    onComplete,
    onSkip,
    transitionTo,
    username,
  ]);

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
    // L8 carry-forward (proposal §8): the I've-got-it link no longer
    // unmounts the wizard. It marks the run as skip-routed (sticky)
    // and jumps to the cleanup grid so the user can still keep or
    // discard everything BeakerBot helped them make.
    setShowSkipConfirm(false);
    setEnteredCleanupViaSkip(true);
    await transitionTo("phase4-cleanup");
  }, [transitionTo]);

  if (!mounted) return null;

  const isFirstStep = idx <= 1;
  const isCleanupStep = currentStep === "phase4-cleanup";
  const progressPct = total > 0 ? Math.round((idx / total) * 100) : 0;

  // P9 pose resolution. Bouncing wins during the transition window.
  // The phase4-cleanup Finish click bumps uiState to "persisting"
  // just before the parent unmounts the wizard; in that window we
  // play the bow-wink farewell. Otherwise we fall back to the step's
  // resting pose.
  const isExitMoment =
    currentStep === "phase4-cleanup" && uiState === "persisting";
  const headerPose: BeakerBotPose = isExitMoment
    ? "bow-wink"
    : isBouncing
      ? "bouncing"
      : restingPoseForStep(currentStep);
  // pointing-right is the safe default direction for the modal slot;
  // the mascot sits to the LEFT of the title in the header, so its
  // pointing finger gestures right toward the step title.
  const headerDirection: "left" | "right" = "right";

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
                pose={headerPose}
                direction={headerDirection}
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
            cleanupDecisions={cleanupDecisions}
            setCleanupDecisions={setCleanupDecisions}
            enteredCleanupViaSkip={enteredCleanupViaSkip}
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

/** Resting-state mascot pose for each step. The wizard shell consults
 *  this on every render so the BeakerBot in the modal header reflects
 *  the current step's energy (welcome=wave, Q1-Q6=think, W*+L*=point,
 *  W5/W7=type live-typing, phase4-cleanup=celebrate). The bouncing
 *  pose layers on top for ~650ms after each step transition; bow-wink
 *  layers on top during the phase4-cleanup persisting window
 *  (Finish-click → unmount). See the BeakerBot.tsx pose docstring for
 *  the canonical pose values. */
function restingPoseForStep(step: WizardStep): BeakerBotPose {
  if (step === "intro") return "waving";
  if (
    step === "setup-q1" ||
    step === "setup-q1a" ||
    step === "setup-q1b" ||
    step === "setup-q2" ||
    step === "setup-q3" ||
    step === "setup-q4" ||
    step === "setup-q5" ||
    step === "setup-q6"
  ) {
    return "thinking";
  }
  if (step === "W5" || step === "W7") return "typing";
  if (
    step === "W1" ||
    step === "W2" ||
    step === "W3" ||
    step === "W4" ||
    step === "W6" ||
    step === "W8" ||
    step === "W9" ||
    step === "W10" ||
    step === "W11" ||
    step === "W12" ||
    step === "W13" ||
    step === "W14" ||
    step === "lab-prompt" ||
    step === "L1" ||
    step === "L2" ||
    step === "L3" ||
    step === "L4" ||
    step === "L5" ||
    step === "L6" ||
    step === "L7" ||
    step === "L8" ||
    step === "L9" ||
    step === "L10" ||
    step === "L11"
  ) {
    return "pointing";
  }
  if (step === "phase4-cleanup") return "cheering";
  return "idle";
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
 *  through setup-q6). P2b fills in W1-W9. P2c fills in W10-W14
 *  (conditional walkthrough). P3a fills in L1-L11. P4 fills in the
 *  cleanup grid; the shell threads the lifted cleanup state through so
 *  handleNext can read the user's keep/discard picks at Finish-click. */
function StepBody({
  step,
  username,
  sidecar,
  setNextDisabled,
  patchSidecar,
  cleanupDecisions,
  setCleanupDecisions,
  enteredCleanupViaSkip,
}: {
  step: WizardStep;
  username: string;
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
  cleanupDecisions: Record<string, "keep" | "discard">;
  setCleanupDecisions: Dispatch<
    SetStateAction<Record<string, "keep" | "discard">>
  >;
  enteredCleanupViaSkip: boolean;
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
    case "W1":
      return (
        <W1CreateProjectStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W2":
      return (
        <W2CreateMethodStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W3":
      return (
        <W3CreateExperimentStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W4":
      return (
        <W4LinkMethodStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W5":
      return (
        <W5HybridEditorTourStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W6":
      return (
        <W6PersonalizationStep
          username={username}
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W7":
      return (
        <W7SearchTourStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W8":
      return (
        <W8NotificationsTourStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W9":
      return <W9WikiPointerStep setNextDisabled={setNextDisabled} />;
    case "W10":
      return (
        <W10PurchasesTourStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W11":
      return (
        <W11GoalsTourStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W12":
      return (
        <W12TelegramWithImageStep
          username={username}
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W13":
      return (
        <W13CalendarTourStep
          username={username}
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "W14":
      return (
        <W14AiHelperStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
        />
      );
    case "lab-prompt":
      return (
        <LabPromptStep
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "L1":
      return <L1WhatIsLabMode setNextDisabled={setNextDisabled} />;
    case "L2":
      return (
        <L2SpawnFakeBeakerBot
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "L3":
      return (
        <L3SeeBeakerBotTask
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
        />
      );
    case "L4":
      return (
        <L4PermissionPractice
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "L5":
      return (
        <L5UserSharesBack
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "L6":
      return (
        <L6RevokeShare
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
        />
      );
    case "L7":
      return (
        <L7GanttAndActivityFeed
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
        />
      );
    case "L8":
      return (
        <L8LabPurchases
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "L9":
      return (
        <L9LabSearch
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
        />
      );
    case "L10":
      return <L10LabWrap setNextDisabled={setNextDisabled} />;
    case "L11":
      return (
        <L11BeakerBotCleanupOption
          sidecar={sidecar}
          setNextDisabled={setNextDisabled}
          patchSidecar={patchSidecar}
        />
      );
    case "phase4-cleanup":
      return (
        <Phase4CleanupStep
          sidecar={sidecar}
          enteredViaSkip={enteredCleanupViaSkip}
          decisions={cleanupDecisions}
          setDecisions={setCleanupDecisions}
          setNextDisabled={setNextDisabled}
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
