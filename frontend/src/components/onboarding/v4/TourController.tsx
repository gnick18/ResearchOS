"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import BeakerBot from "@/components/BeakerBot";
import BeakerBotCursor, {
  type BeakerBotCursorRef,
} from "@/components/BeakerBotCursor";
import TourSpotlight from "@/components/TourSpotlight";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import { getStep, TOUR_STEPS } from "./step-registry";
import {
  firstApplicableStep,
  getNextStep,
  getPreviousStep,
  isLabPhaseStep,
  isSetupPhaseStep,
} from "./step-machine";
import type { TourStep, TourStepId } from "./step-types";

/**
 * Onboarding v4 tour controller — see ONBOARDING_V4_PROPOSAL.md §4.1.
 *
 * Owns the global tour state machine (current step, tour mode flag,
 * step-completion detection, gentle-redirect tracking) and exposes an
 * imperative API via `useTourController()`. Replaces v3's
 * `WizardMount.tsx` + state machine + step dispatcher.
 *
 * **Architectural calls flagged for master review:**
 *
 *  1. `useReducer` for the controller's discrete state transitions —
 *     `start`, `advance`, `goBack`, `skipStep`, `exitTour`, `pause`,
 *     `resume` each map to an action type. State has enough internal
 *     coupling (currentStep + tourMode + interactedWithCurrentStep +
 *     stepCompletion travel together) that `useState`-per-field would
 *     leak inconsistent intermediate states. Reducer keeps every
 *     transition atomic.
 *  2. Context-based propagation (not zustand) — v3's analogous
 *     `OnboardingProvider` is also Context-based, so this matches the
 *     codebase pattern. Zustand is reserved for the global app store
 *     (`useAppStore`) which holds cross-cutting persistence-y state;
 *     the tour controller is short-lived per-session, no persistence
 *     beyond the sidecar's `wizard_resume_state` (P12).
 *  3. Overlay rendering co-located with the provider — the provider
 *     renders BOTH the controller-state-owning Context AND the
 *     `<TourBeakerBotOverlay />` / `<TourSpotlight />` / `<BeakerBotCursor />`
 *     so consumers don't have to remember to mount three components
 *     separately. The overlay short-circuits to `null` when
 *     `tourMode === null`, so the cost when no tour is active is a
 *     single render of empty fragments.
 *
 * **Mount status (P1):** This provider is NOT wired into
 * `lib/providers.tsx` yet — per the P1 brief, mounting is intentionally
 * deferred so a no-op tour state can't affect production users. P4
 * (setup phase port) + P11 (Settings re-run reconnect) own the actual
 * activation.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TourMode =
  | "modal-setup"
  | "in-product-walkthrough"
  | "lab"
  | "cleanup"
  | null;

/**
 * Hybrid step-completion progress per L6. The controller tracks both
 * `manual` (user clicked "Got it, next") AND `eventFired` (the step's
 * `eventListener` invoked the advance callback) so a step's body can
 * decide whether to advance on EITHER signal or REQUIRE both — P5+
 * step bodies will declare their preference; P1 just plumbs the state.
 */
export interface StepCompletion {
  manual: boolean;
  eventFired: boolean;
}

export interface TourControllerState {
  currentStep: TourStepId | null;
  tourMode: TourMode;
  /** True once the user clicked / typed anywhere during the active
   *  step. Reset to false on every step transition. The gentle-redirect
   *  detection (L11) consults this to decide whether a wrong-target
   *  click should produce the speech-bubble "almost — try this one"
   *  prompt vs stay silent on the first interaction. */
  interactedWithCurrentStep: boolean;
  /** Hybrid completion progress for the active step (see `L6`). */
  stepCompletion: StepCompletion;
  /** True when the tour is paused (per L23 tour-interruption handling).
   *  A paused tour keeps `currentStep` set but hides the BeakerBot
   *  overlay + spotlight, and `advance` / `goBack` short-circuit until
   *  `resume()` flips the flag. */
  paused: boolean;
  /** The `FeaturePicks` last read from the active user's sidecar. Set
   *  via `setFeaturePicks` after Phase 1 setup completes. The step
   *  machine consults this for L16 gating. P1 stores the value but
   *  doesn't enforce a write contract — P4 (setup port) wires this up
   *  to the sidecar patch on each setup answer. */
  featurePicks: FeaturePicks | null;
}

export interface TourControllerActions {
  /** Kick off the tour. Optional `initialStep` jumps to a specific
   *  step (e.g., "phase4-cleanup" on "I've got it from here"). */
  start(initialStep?: TourStepId): void;
  /** Proceed to the next applicable step under the current
   *  `featurePicks`. No-op when no tour is active or when the current
   *  step has no next step. */
  advance(): void;
  /** Return to the previous applicable step. No-op when no tour is
   *  active or when the current step has no previous step. */
  goBack(): void;
  /** Mark the current step as skipped + advance. Per L10, the skipped
   *  set is part of `wizard_resume_state` (P12 wires this to the
   *  sidecar; P1 just records it in memory). */
  skipStep(): void;
  /** "I've got it from here" path (L10). Jumps directly to the cleanup
   *  phase grid so the user can decide which artifacts to keep. */
  exitTour(): void;
  /** Pause the tour (per L23). The BeakerBot overlay + spotlight hide
   *  but the step state survives. */
  pause(): void;
  /** Resume a paused tour. */
  resume(): void;
  /** Update the active `FeaturePicks` (typically called by the Phase 1
   *  setup step bodies after each answer; P4 wires this end-to-end). */
  setFeaturePicks(picks: FeaturePicks | null): void;
  /** Mark `interactedWithCurrentStep = true` — called by the overlay
   *  click/keydown listener (L11 gentle-redirect detection). P1
   *  exposes the toggle; P5+ overlay click handler wires it up. */
  noteInteraction(): void;
  /** Mark `stepCompletion.eventFired = true` and (if the step's body
   *  declares event-driven completion) advance. P5+ step bodies invoke
   *  this from their `eventListener` callbacks. */
  noteEventFired(): void;
  /** Mark `stepCompletion.manual = true` and (if the step's body
   *  declares manual completion) advance. The overlay's "Got it, next"
   *  button wires up to this. */
  noteManualAdvance(): void;
  /** List of step ids the user invoked `skipStep()` on, in order. Read
   *  by P12 when writing to `wizard_resume_state.skipped_steps`. */
  readonly skippedSteps: ReadonlyArray<TourStepId>;
}

export type TourControllerValue = TourControllerState & TourControllerActions;

// ---------------------------------------------------------------------------
// Context plumbing
// ---------------------------------------------------------------------------

const TourControllerContext = createContext<TourControllerValue | null>(null);

/**
 * Hook for reading + driving the tour controller. Throws when called
 * outside `<TourControllerProvider>` so a mis-wired consumer fails
 * fast rather than silently no-op'ing.
 */
export function useTourController(): TourControllerValue {
  const ctx = useContext(TourControllerContext);
  if (!ctx) {
    throw new Error(
      "useTourController() called outside <TourControllerProvider>",
    );
  }
  return ctx;
}

/**
 * Optional variant — returns `null` outside a provider instead of
 * throwing. Used by components that want to opt into tour-aware
 * behavior only when the provider is mounted (e.g. AppShell's top-nav
 * gating). When the provider isn't mounted (the P1 state — the
 * provider exists but isn't wired into providers.tsx yet), this
 * returns `null` so consumers behave exactly as they did pre-v4.
 */
export function useOptionalTourController(): TourControllerValue | null {
  return useContext(TourControllerContext);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type Action =
  | { type: "START"; initialStep: TourStepId | null }
  | { type: "SET_STEP"; nextStep: TourStepId | null; nextMode: TourMode }
  | { type: "MARK_INTERACTION" }
  | { type: "MARK_EVENT_FIRED" }
  | { type: "MARK_MANUAL_ADVANCE" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "SET_FEATURE_PICKS"; picks: FeaturePicks | null }
  | { type: "EXIT" };

interface ReducerState extends TourControllerState {
  /** In-memory shadow of the to-be-persisted skipped-steps list (P12
   *  copies this into `wizard_resume_state.skipped_steps`). */
  skippedSteps: TourStepId[];
}

const initialState: ReducerState = {
  currentStep: null,
  tourMode: null,
  interactedWithCurrentStep: false,
  stepCompletion: { manual: false, eventFired: false },
  paused: false,
  featurePicks: null,
  skippedSteps: [],
};

/** Compute the tour mode that the given step belongs to. Setup steps →
 *  "modal-setup". Lab steps → "lab". Cleanup grid step → "cleanup".
 *  Everything else (universal + conditional walkthrough) →
 *  "in-product-walkthrough" — the mode that triggers AppShell's
 *  top-nav gate per L23. */
function modeForStep(step: TourStepId | null): TourMode {
  if (step === null) return null;
  if (isSetupPhaseStep(step)) return "modal-setup";
  if (isLabPhaseStep(step)) return "lab";
  if (step === "phase4-cleanup") return "cleanup";
  return "in-product-walkthrough";
}

function reducer(state: ReducerState, action: Action): ReducerState {
  switch (action.type) {
    case "START": {
      const next = action.initialStep ?? firstApplicableStep(state.featurePicks);
      return {
        ...state,
        currentStep: next,
        tourMode: modeForStep(next),
        interactedWithCurrentStep: false,
        stepCompletion: { manual: false, eventFired: false },
        paused: false,
      };
    }
    case "SET_STEP": {
      return {
        ...state,
        currentStep: action.nextStep,
        tourMode: action.nextMode,
        interactedWithCurrentStep: false,
        stepCompletion: { manual: false, eventFired: false },
      };
    }
    case "MARK_INTERACTION": {
      if (state.interactedWithCurrentStep) return state;
      return { ...state, interactedWithCurrentStep: true };
    }
    case "MARK_EVENT_FIRED": {
      if (state.stepCompletion.eventFired) return state;
      return {
        ...state,
        stepCompletion: { ...state.stepCompletion, eventFired: true },
      };
    }
    case "MARK_MANUAL_ADVANCE": {
      if (state.stepCompletion.manual) return state;
      return {
        ...state,
        stepCompletion: { ...state.stepCompletion, manual: true },
      };
    }
    case "PAUSE":
      return { ...state, paused: true };
    case "RESUME":
      return { ...state, paused: false };
    case "SET_FEATURE_PICKS":
      return { ...state, featurePicks: action.picks };
    case "EXIT":
      return {
        ...state,
        currentStep: null,
        tourMode: null,
        interactedWithCurrentStep: false,
        stepCompletion: { manual: false, eventFired: false },
        paused: false,
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface TourControllerProviderProps {
  children: ReactNode;
  /** Optional seed for initial feature picks — useful in tests + when
   *  resuming a mid-tour state from the sidecar. */
  initialFeaturePicks?: FeaturePicks | null;
  /** Optional initial step. When set, the controller starts in an
   *  ACTIVE state at this step. When unset (P1 default), the controller
   *  starts dormant and `start()` activates it. */
  initialStep?: TourStepId | null;
}

export function TourControllerProvider({
  children,
  initialFeaturePicks = null,
  initialStep = null,
}: TourControllerProviderProps) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    featurePicks: initialFeaturePicks,
    currentStep: initialStep,
    tourMode: modeForStep(initialStep),
  });

  // A second reducer dimension for the skip-list mutation — kept as a
  // single useState-managed list so we can hand the array directly to
  // consumers via `value.skippedSteps` without copying.
  const [skipList, setSkipList] = useState<TourStepId[]>([]);

  // Stable refs for the latest feature picks + current step so the
  // action callbacks below can read the freshest values without
  // recreating themselves on every render (which would invalidate
  // downstream effect deps in P5+ step bodies).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Step body lookup at the current step. P1 pulls from the registry
  // (placeholder bodies); P4+ swap in real bodies one entry at a time.
  const currentStepBody: TourStep | undefined = state.currentStep
    ? getStep(state.currentStep)
    : undefined;

  // -------------------------------------------------------------------
  // Action callbacks
  // -------------------------------------------------------------------

  const start = useCallback((initial?: TourStepId) => {
    dispatch({ type: "START", initialStep: initial ?? null });
  }, []);

  const advance = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.currentStep) return;
    const next = getNextStep(cur.currentStep, cur.featurePicks);
    dispatch({ type: "SET_STEP", nextStep: next, nextMode: modeForStep(next) });
  }, []);

  const goBack = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.currentStep) return;
    const prev = getPreviousStep(cur.currentStep, cur.featurePicks);
    if (prev === null) return;
    dispatch({ type: "SET_STEP", nextStep: prev, nextMode: modeForStep(prev) });
  }, []);

  const skipStep = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.currentStep) return;
    // Record the skip BEFORE advancing so the post-advance render sees
    // the up-to-date list. The setState inside useState is sync from
    // the user's perspective — the next render reads it.
    const skippedId = cur.currentStep;
    setSkipList((prev) =>
      prev.includes(skippedId) ? prev : [...prev, skippedId],
    );
    const next = getNextStep(cur.currentStep, cur.featurePicks);
    dispatch({ type: "SET_STEP", nextStep: next, nextMode: modeForStep(next) });
  }, []);

  const exitTour = useCallback(() => {
    // "I've got it from here" (L10) — jump straight to the cleanup
    // grid so the user can decide which artifacts the partial tour
    // created should be kept vs discarded.
    dispatch({
      type: "SET_STEP",
      nextStep: "phase4-cleanup",
      nextMode: modeForStep("phase4-cleanup"),
    });
  }, []);

  const pause = useCallback(() => dispatch({ type: "PAUSE" }), []);
  const resume = useCallback(() => dispatch({ type: "RESUME" }), []);

  const setFeaturePicks = useCallback((picks: FeaturePicks | null) => {
    dispatch({ type: "SET_FEATURE_PICKS", picks });
  }, []);

  const noteInteraction = useCallback(
    () => dispatch({ type: "MARK_INTERACTION" }),
    [],
  );

  // Auto-advance behavior — when the current step's completion contract
  // is satisfied (event-driven step + event fired, manual step + button
  // clicked, etc.), schedule an advance. The reducer can't do this
  // inline because we need access to `currentStepBody.completion` which
  // lives outside the reducer. We post-process by watching the
  // stepCompletion state in an effect.
  const noteEventFired = useCallback(
    () => dispatch({ type: "MARK_EVENT_FIRED" }),
    [],
  );
  const noteManualAdvance = useCallback(
    () => dispatch({ type: "MARK_MANUAL_ADVANCE" }),
    [],
  );

  // Watch the current step's completion progress; advance when the
  // declared completion contract is satisfied. The body's completion
  // shape is fixed for the lifetime of the step, so this effect doesn't
  // need to subscribe per-field — it just reads the active body's
  // completion type on each pass.
  useEffect(() => {
    if (!state.currentStep || !currentStepBody || state.paused) return;
    const completion = currentStepBody.completion;
    if (completion.type === "event" && state.stepCompletion.eventFired) {
      advance();
    } else if (completion.type === "manual" && state.stepCompletion.manual) {
      advance();
    }
    // No 'auto' branch — handled by the onEnter effect below which
    // schedules a setTimeout for `autoAdvanceAfterMs`. The completion
    // state vector doesn't carry an "auto" flag because the timer is
    // self-driving.
  }, [
    state.currentStep,
    state.paused,
    state.stepCompletion.eventFired,
    state.stepCompletion.manual,
    currentStepBody,
    advance,
  ]);

  // Step lifecycle: fire onEnter on entry, schedule auto-advance timer,
  // wire up the step's event listener (if any), call onExit on exit.
  // The dependency only on `state.currentStep` is intentional — the
  // body lookup is stable across renders within a step (the registry is
  // module-level), so re-running the effect on every render would tear
  // down + rebuild listeners spuriously.
  useEffect(() => {
    if (!state.currentStep) return;
    const body = getStep(state.currentStep);
    if (!body) return;

    let cancelled = false;
    let autoTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    // Fire onEnter — awaited so the controller doesn't race with side
    // effects (e.g., onEnter calls router.push and the next paint needs
    // to wait for navigation). Errors are swallowed + logged; a buggy
    // onEnter shouldn't deadlock the whole tour.
    Promise.resolve()
      .then(() => body.onEnter?.())
      .catch((err) => {
        console.error(
          `[TourController] onEnter for step "${body.id}" threw:`,
          err,
        );
      });

    // Wire up event-driven completion if declared.
    if (body.completion.type === "event") {
      try {
        unsubscribe = body.completion.eventListener(() => {
          if (!cancelled) dispatch({ type: "MARK_EVENT_FIRED" });
        });
      } catch (err) {
        console.error(
          `[TourController] event listener setup for step "${body.id}" threw:`,
          err,
        );
      }
    }

    // Schedule auto-advance if declared.
    if (body.completion.type === "auto") {
      autoTimer = setTimeout(() => {
        if (!cancelled) dispatch({ type: "MARK_EVENT_FIRED" });
      }, body.completion.autoAdvanceAfterMs);
    }

    return () => {
      cancelled = true;
      if (autoTimer) clearTimeout(autoTimer);
      try {
        unsubscribe?.();
      } catch (err) {
        console.error(
          `[TourController] unsubscribe for step "${body.id}" threw:`,
          err,
        );
      }
      Promise.resolve()
        .then(() => body.onExit?.())
        .catch((err) => {
          console.error(
            `[TourController] onExit for step "${body.id}" threw:`,
            err,
          );
        });
    };
  }, [state.currentStep]);

  // The auto-advance-on-MARK_EVENT_FIRED path lives in the effect above
  // (the `completion.type === "event"` branch advances when
  // stepCompletion.eventFired flips). For "auto" steps we re-use the
  // same `eventFired` flag — see the comment at the SET_STEP handler.
  // This keeps the state vector minimal (one boolean per "non-manual
  // completion") while still letting "manual" steps wait for the user.

  // -------------------------------------------------------------------
  // Memoized context value
  // -------------------------------------------------------------------

  const value = useMemo<TourControllerValue>(
    () => ({
      ...state,
      skippedSteps: skipList,
      start,
      advance,
      goBack,
      skipStep,
      exitTour,
      pause,
      resume,
      setFeaturePicks,
      noteInteraction,
      noteEventFired,
      noteManualAdvance,
    }),
    [
      state,
      skipList,
      start,
      advance,
      goBack,
      skipStep,
      exitTour,
      pause,
      resume,
      setFeaturePicks,
      noteInteraction,
      noteEventFired,
      noteManualAdvance,
    ],
  );

  return (
    <TourControllerContext.Provider value={value}>
      {children}
      <TourOverlay />
    </TourControllerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Overlay — BeakerBot mascot + speech bubble + cursor + spotlight
// ---------------------------------------------------------------------------

/**
 * The single component that paints every tour-mode visual: spotlight,
 * cursor, and the bottom-right BeakerBot + speech bubble. Lives inside
 * the provider so a consumer just has to mount the provider, not three
 * separate components.
 *
 * Short-circuits to `null` when no tour is active OR when the tour is
 * paused (per L23). The cost-when-off is a single context read + a
 * boolean check.
 */
function TourOverlay() {
  const controller = useTourController();
  const cursorRef = useRef<BeakerBotCursorRef>(null);

  if (!controller.currentStep || controller.paused) return null;

  const body = getStep(controller.currentStep);

  // Spotlight only renders during the in-product walkthrough mode
  // (setup steps live in a modal, lab steps spawn their own surfaces,
  // cleanup step is a full-screen grid — none want the dim-and-glow
  // anchor treatment).
  const showSpotlight =
    controller.tourMode === "in-product-walkthrough" && !!body?.targetSelector;

  return (
    <>
      {showSpotlight && body?.targetSelector && (
        <TourSpotlight target={body.targetSelector} />
      )}
      <BeakerBotCursor ref={cursorRef} />
      <TourBeakerBotOverlay
        step={body}
        onManualAdvance={controller.noteManualAdvance}
        onSkipStep={controller.skipStep}
        onExitTour={controller.exitTour}
      />
    </>
  );
}

/**
 * BeakerBot mascot floating bottom-right + speech bubble above-left
 * per L4. The bubble shows the active step's `speech` content, an
 * "I've got it from here" exit link in the corner, and a per-step
 * "Skip" link. Manual completion ("Got it, next") button is shown only
 * when the step's body declares manual completion.
 *
 * P1 ships a minimal but functional bubble — P5+ may dress it further
 * (typewriter cadence, pose transitions per speech beat). The minimal
 * shape unblocks every P4-P7 chip from depending on overlay polish.
 */
interface TourBeakerBotOverlayProps {
  step: TourStep | undefined;
  onManualAdvance: () => void;
  onSkipStep: () => void;
  onExitTour: () => void;
}

function TourBeakerBotOverlay({
  step,
  onManualAdvance,
  onSkipStep,
  onExitTour,
}: TourBeakerBotOverlayProps) {
  if (!step) return null;

  const speechNode = typeof step.speech === "function" ? step.speech() : step.speech;

  const manualButtonLabel =
    step.completion.type === "manual"
      ? step.completion.buttonLabel ?? "Got it, next"
      : null;

  return (
    <div
      data-testid="tour-beakerbot-overlay"
      className="fixed bottom-6 right-6 z-[450] pointer-events-none flex flex-col items-end gap-2"
      style={{ maxWidth: 360 }}
    >
      {/* Speech bubble. Above-and-to-the-left of the BeakerBot per L4.
          Pointer events are re-enabled here so the user can click
          Skip / Exit / Got it — the wrapper above is non-interactive so
          it doesn't block clicks anywhere else on the page-body. */}
      <div
        data-testid="tour-beakerbot-bubble"
        className="pointer-events-auto bg-white border border-gray-200 rounded-2xl shadow-xl p-4 text-sm text-gray-800"
        style={{ maxWidth: 320 }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <button
            type="button"
            onClick={onExitTour}
            className="text-xs text-sky-600 hover:text-sky-700 underline underline-offset-2 whitespace-nowrap"
            aria-label="Exit tour: I've got it from here"
          >
            I&apos;ve got it from here
          </button>
        </div>
        <div data-testid="tour-beakerbot-speech" className="leading-relaxed">
          {speechNode}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkipStep}
            className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
            aria-label="Skip this step"
          >
            Skip this step
          </button>
          {manualButtonLabel && (
            <button
              type="button"
              onClick={onManualAdvance}
              className="text-xs font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-full px-3 py-1.5"
              aria-label={manualButtonLabel}
            >
              {manualButtonLabel}
            </button>
          )}
        </div>
      </div>
      {/* BeakerBot mascot — pointing pose by default, overridden by the
          step's `pose` declaration. Pointer events stay off so the
          mascot doesn't intercept clicks on the page body. */}
      <div className="pointer-events-none">
        <BeakerBot pose={step.pose} className="w-20 h-20 text-sky-500" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { TOUR_STEPS, getStep };
export type { TourStep, TourStepId };
