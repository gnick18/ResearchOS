"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import BeakerBotCursor, {
  type BeakerBotCursorRef,
} from "@/components/BeakerBotCursor";
import TourSpotlight from "@/components/TourSpotlight";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import { getStep, TOUR_STEPS } from "./step-registry";
import {
  firstApplicableStep,
  getNextStep,
  getPreviousStep,
  isLabPhaseStep,
  isSetupPhaseStep,
} from "./step-machine";
import {
  getSetupDescriptor,
  type SetupStepDescriptor,
} from "./steps/setup";
import Phase4CleanupStep from "./steps/cleanup/Phase4CleanupStep";
import type { CleanupSummary } from "./steps/cleanup/cleanup-execution";
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
  /** True once the user reached the Phase 4 cleanup grid via the
   *  "I've got it from here" link (per L10) rather than by completing
   *  every prior step. Sticky once flipped; the cleanup grid's Finish
   *  handler reads this to pick onComplete (writes wizard_completed_at)
   *  vs onSkip (writes wizard_skipped_at). */
  enteredCleanupViaSkip: boolean;
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
  | { type: "MARK_CLEANUP_ENTERED_VIA_SKIP" }
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
  enteredCleanupViaSkip: false,
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
    case "MARK_CLEANUP_ENTERED_VIA_SKIP":
      if (state.enteredCleanupViaSkip) return state;
      return { ...state, enteredCleanupViaSkip: true };
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
  /** Current onboarding sidecar snapshot. Threaded into:
   *  - the modal-setup step bodies (P4 / Phase 1) so they can read
   *    feature_picks and write picks via `patchSidecar`,
   *  - the Phase 4 cleanup grid (P8) so the grid can read
   *    `wizard_resume_state.artifacts_created`.
   *  Optional: tours that don't need sidecar access (e.g. P5+
   *  walkthroughs in isolation tests) work without it. Setup-phase
   *  bodies degrade to a no-persist mode; the cleanup grid degrades
   *  to its empty-state. */
  sidecar?: OnboardingSidecar | null;
  /** Persistence hook the modal-setup bodies call to write Q1-Q6
   *  feature_picks. Same signature as v3's `OnboardingWizardV3.patchSidecar`.
   *  Returns a promise the body awaits before clearing its local in-flight
   *  flag; absent means step bodies render in a no-op state (see `sidecar`
   *  prop docstring). */
  patchSidecar?: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
  /** Username for the active user. Threaded into the Phase 4 cleanup
   *  step so its `cleanupArtifacts` sweep can resolve per-user file
   *  paths (settings revert, telegram inbox, etc.). Optional because
   *  the controller is used in tests without an end-to-end user
   *  identity. */
  username?: string;
  /** Called when the user clicks Finish on the Phase 4 cleanup grid on
   *  the normal completion path. The parent (typically a v4 wizard
   *  shell, lands in P11) writes `wizard_completed_at` and clears
   *  `wizard_resume_state` here. P8 plumbs the prop; P11 wires the
   *  persistence end. */
  onComplete?: (summary: CleanupSummary) => void | Promise<void>;
  /** Called when the user clicks Finish on the Phase 4 cleanup grid
   *  AND `enteredCleanupViaSkip` is true (user came from the "I've
   *  got it from here" path). The parent writes `wizard_skipped_at`
   *  instead of `wizard_completed_at`. P8 plumbs the prop; P11 wires
   *  the persistence end. */
  onSkip?: (summary: CleanupSummary) => void | Promise<void>;
}

export function TourControllerProvider({
  children,
  initialFeaturePicks = null,
  initialStep = null,
  sidecar = null,
  patchSidecar,
  username,
  onComplete,
  onSkip,
}: TourControllerProviderProps) {
  const router = useRouter();
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
    // created should be kept vs discarded. Mark the entered-via-skip
    // flag BEFORE the SET_STEP so the cleanup grid (which reads the
    // flag on render) renders the skip-flavored intro copy on the
    // very first paint, and so Finish routes through onSkip even on
    // a fast double-click that bypasses a re-render.
    dispatch({ type: "MARK_CLEANUP_ENTERED_VIA_SKIP" });
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

  // P12 resume contract: persist `current_step` + `skipped_steps` to the
  // sidecar's `wizard_resume_state` on every step transition. The
  // TourBootstrap component reads this on next mount and offers
  // Restart / Resume / Discard. Without this effect, a refresh wipes the
  // user's progress and the welcome step re-fires from scratch — the
  // bug Grant flagged in P12 brief.
  //
  // Skip the write when:
  //   - patchSidecar isn't wired (test/no-persist mode),
  //   - currentStep is null (tour ended / not started — the onComplete /
  //     onSkip handlers own clearing the resume state in those cases).
  // Keep `artifacts_created` from the current sidecar untouched; P5+
  // steps that mint artifacts manage that list via separate patches.
  useEffect(() => {
    if (!patchSidecar) return;
    if (state.currentStep === null) return;
    const stepId = state.currentStep;
    const skipped = [...skipList];
    void patchSidecar((cur) => ({
      ...cur,
      wizard_resume_state: {
        current_step: stepId,
        skipped_steps: skipped,
        artifacts_created: cur.wizard_resume_state?.artifacts_created ?? [],
      },
    })).catch((err) => {
      console.error(
        "[TourController] persist wizard_resume_state failed:",
        err,
      );
    });
  }, [state.currentStep, skipList, patchSidecar]);

  // Step lifecycle: schedule auto-advance timer, wire up the step's
  // event listener (if any), call onExit on exit. `onEnter` lives in
  // its own sibling effect below so it can thread the active username
  // through ctx without entangling listener-cleanup deps.
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

    // Schedule auto-advance if declared. The completion watcher above
    // only advances on `event` or `manual` completion types, so for
    // `auto` we must call advance() directly here. (Earlier code
    // dispatched MARK_EVENT_FIRED but that flag is only consumed when
    // completion.type === "event"; auto steps got stuck because the
    // watcher silently ignored the flag. Grant's repeated "§6.2 hangs
    // after typing" reports surfaced this.)
    if (body.completion.type === "auto") {
      autoTimer = setTimeout(() => {
        if (!cancelled) advance();
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

  // Per-step `onEnter` side-effect hook (sibling to the lifecycle
  // effect above). Steps use this to fire programmatic side effects
  // tied to step entry. §6.3 fires a test notification so the bell
  // badge lights up before BeakerBot's cursor demos the click; §6.8
  // spawns demo dependency-chain tasks; etc.
  //
  // The hook receives a context object with the active username so the
  // side effect can resolve per-user storage paths via local-api
  // (`sharingApi.createEventReminder` reads `getCurrentUserCached()`
  // internally so the explicit ctx is currently informational; future
  // hooks that need a different writer identity can take it from ctx).
  //
  // Paused tours skip the hook entirely so an in-flight pause doesn't
  // race ahead and spawn artifacts the user hasn't seen the lead-in for.
  // Errors are caught + logged so a buggy hook never wedges the tour.
  useEffect(() => {
    if (!state.currentStep || state.paused) return;
    const body = getStep(state.currentStep);
    if (!body?.onEnter) return;

    let cancelled = false;
    void (async () => {
      try {
        await body.onEnter?.({ username: username ?? null });
      } catch (err) {
        if (!cancelled) {
          console.warn(
            `[onboarding-v4] step onEnter for "${body.id}" failed`,
            err,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.currentStep, state.paused, username]);

  // The auto-advance-on-MARK_EVENT_FIRED path lives in the effect above
  // (the `completion.type === "event"` branch advances when
  // stepCompletion.eventFired flips). For "auto" steps we re-use the
  // same `eventFired` flag — see the comment at the SET_STEP handler.
  // This keeps the state vector minimal (one boolean per "non-manual
  // completion") while still letting "manual" steps wait for the user.

  // Auto-navigate to the step's `expectedRoute` when the browser is on
  // the wrong page. Grant's refresh-mid-tour bug: refreshing on a
  // non-home page (e.g. while viewing a project) and resuming the
  // tour put BeakerBot on `home-create-project` while the browser was
  // still on the project route, so BeakerBot pointed at a "New
  // Project" button that wasn't on screen. Pushing to `expectedRoute`
  // on step entry restores the assumed-route invariant for every
  // fixed-route step. Dynamic-route steps (project page,
  // experiment popup) leave `expectedRoute` unset and are entered via
  // cursor demos clicking through. The match is a prefix `startsWith`
  // check so `expectedRoute: "/methods"` treats both `/methods` and
  // `/methods/structured/pcr-builder` as "already on the right page."
  useEffect(() => {
    if (!state.currentStep || state.paused) return;
    const body = getStep(state.currentStep);
    if (!body?.expectedRoute) return;

    // SSR guard. Tests under jsdom still have `window`; the guard is
    // here for the rare case of the controller mounting during an
    // SSR hydration before window is defined.
    if (typeof window === "undefined") return;
    const current = window.location.pathname;
    const expected = body.expectedRoute;

    // Match contract: prefix match (`startsWith`) for everything EXCEPT
    // the home route. `/` would prefix-match every path, which would
    // mean home-rooted steps never auto-navigate from a sub-page (the
    // exact bug Grant hit, where refreshing on /workbench/projects/<id>
    // while on a home-rooted step never moved him back to home). Treat
    // `/` as an exact-match route and any other path as a prefix.
    const alreadyOnRoute =
      expected === "/" ? current === "/" : current.startsWith(expected);
    if (alreadyOnRoute) return;

    router.push(expected);
  }, [state.currentStep, state.paused, router]);

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
      <TourOverlay
        sidecar={sidecar}
        patchSidecar={patchSidecar}
        username={username}
        onComplete={onComplete}
        onSkip={onSkip}
      />
    </TourControllerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Overlay — BeakerBot mascot + speech bubble + cursor + spotlight + cleanup
// ---------------------------------------------------------------------------

interface TourOverlayProps {
  sidecar: OnboardingSidecar | null;
  patchSidecar?: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
  username?: string;
  onComplete?: (summary: CleanupSummary) => void | Promise<void>;
  onSkip?: (summary: CleanupSummary) => void | Promise<void>;
}

/**
 * The single component that paints every tour-mode visual: spotlight,
 * cursor, the bottom-right BeakerBot + speech bubble, AND:
 *   - (P4) the Phase 1 modal-setup shell when `tourMode === "modal-setup"`,
 *   - (P8) the full-screen Phase 4 cleanup grid when `tourMode === "cleanup"`.
 * Lives inside the provider so a consumer just has to mount the provider,
 * not multiple components.
 *
 * Short-circuits to `null` when no tour is active OR when the tour is
 * paused (per L23). The cost-when-off is a single context read + a
 * boolean check.
 */
function TourOverlay({
  sidecar,
  patchSidecar,
  username,
  onComplete,
  onSkip,
}: TourOverlayProps) {
  const controller = useTourController();

  // Lifted decision state for the Phase 4 cleanup grid. Externalized
  // here (vs co-located inside Phase4CleanupStep) so a back-step into
  // the cleanup grid restores the user's toggles. P12's resume contract
  // will fold this into `wizard_resume_state` so a mid-cleanup tab close
  // can be resumed without losing per-row decisions.
  const [cleanupDecisions, setCleanupDecisions] = useState<
    Record<string, "keep" | "discard">
  >({});

  if (!controller.currentStep || controller.paused) return null;

  // Phase 1 modal-setup surface (P4). Per L9 the setup phase stays
  // modal-contained because the questions are pure data collection with
  // no real product surface to anchor on. The shell mirrors v3's
  // OnboardingWizardV3 modal chrome (centered card on a dim backdrop)
  // and routes Next / Back / Skip / Exit through the controller's
  // existing actions so the rest of the tour graph stays consistent.
  if (controller.tourMode === "modal-setup") {
    const descriptor = getSetupDescriptor(controller.currentStep);
    if (!descriptor) return null;
    return (
      <ModalSetupShell
        stepId={controller.currentStep}
        descriptor={descriptor}
        sidecar={sidecar}
        patchSidecar={patchSidecar}
        onAdvance={controller.advance}
        onBack={controller.goBack}
        onSkipStep={controller.skipStep}
        onExitTour={controller.exitTour}
      />
    );
  }

  // Phase 4 cleanup-grid surface (P8). Per §6.17 + L24 + the P8 brief
  // this is a full-screen review surface, NOT the bottom-right BeakerBot
  // overlay. The grid owns its own modal-style backdrop + a tiny
  // BeakerBot in the corner; the bottom-right BeakerBot suppresses
  // during cleanup so the two don't visually compete. Finish dispatches
  // `cleanupArtifacts` and calls onComplete (or onSkip if reached via
  // "I've got it from here"). The host (P11 wizard shell) wires
  // onComplete + onSkip to the sidecar persistence.
  if (controller.tourMode === "cleanup") {
    return (
      <Phase4CleanupStep
        sidecar={sidecar}
        enteredViaSkip={controller.enteredCleanupViaSkip}
        username={username ?? ""}
        decisions={cleanupDecisions}
        setDecisions={setCleanupDecisions}
        onComplete={async (summary) => {
          await onComplete?.(summary);
        }}
        onSkip={async (summary) => {
          await onSkip?.(summary);
        }}
      />
    );
  }

  // In-product walkthrough surface — extracted into its own component
  // so the cursorRef + cursor-script effect get a stable hook order
  // (TourOverlay's tourMode branching produces a different hook count
  // per render, so attaching the effect here would violate rules-of-
  // hooks). The dedicated component mounts only while we're in the
  // walkthrough mode, which also scopes the cursor + spotlight portals
  // to the lifetime of the walkthrough — they tear down cleanly when
  // the tour exits or transitions to a different mode.
  //
  // The Back affordance (v4 polish round 3) only renders when goBack()
  // would actually move somewhere — `firstApplicableStep(featurePicks)`
  // identifies the head of the current applicable sequence, and we
  // hide the link when the user is sitting on it. Hiding (not just
  // disabling) keeps the bottom-left of the bubble clean for the
  // common case where Back is unavailable.
  const isAtFirstStep =
    controller.currentStep === firstApplicableStep(controller.featurePicks);
  return (
    <InProductWalkthroughOverlay
      currentStep={controller.currentStep}
      onManualAdvance={controller.noteManualAdvance}
      onSkipStep={controller.skipStep}
      onExitTour={controller.exitTour}
      onBack={controller.goBack}
      canGoBack={!isAtFirstStep}
    />
  );
}

// ---------------------------------------------------------------------------
// In-product walkthrough overlay: spotlight + cursor + BeakerBot bubble
// ---------------------------------------------------------------------------

interface InProductWalkthroughOverlayProps {
  currentStep: TourStepId;
  onManualAdvance: () => void;
  onSkipStep: () => void;
  onExitTour: () => void;
  /** v4 polish round 3: surface goBack() in the speech bubble so a user
   *  who clicked off-target or deleted a step's prereq can rewind one
   *  step without restarting the tour. */
  onBack: () => void;
  /** False when the controller is already on the first applicable step
   *  (goBack would be a no-op); the overlay hides the Back link in that
   *  state so the bubble's bottom-left stays clean. */
  canGoBack: boolean;
}

/**
 * Renders the three in-product walkthrough surfaces (spotlight, cursor,
 * BeakerBot speech bubble) AND runs the active step's `cursorScript`
 * through the BeakerBotCursor's imperative ref on every step entry.
 *
 * Why this lives in its own component (vs inline inside `TourOverlay`):
 *  - The cursorRef + the cursor-script effect need a stable hook order.
 *    `TourOverlay` branches on `tourMode` and short-circuits via
 *    multiple early returns, so a hook declared there would tear down
 *    + re-attach on every mode change — fragile + violates rules-of-
 *    hooks if the branches return before the hook runs.
 *  - Mounting the cursor here scopes its lifetime to the walkthrough
 *    phase. When the tour ends or hands off to cleanup/lab modes the
 *    cursor portal unmounts automatically, so we don't leave a
 *    fixed-position SVG floating in the DOM.
 *
 * Cursor-script contract (per P5's lib/cursor-script.ts):
 *  - `step.cursorScript` is `() => Promise<CursorAction[]>`.
 *  - The effect awaits the builder, then plays the resulting actions
 *    through `cursorRef.current.runScript(actions)`. The runScript
 *    primitive sequences glide/click/type/drag with awaits per step,
 *    so a single `await` here covers the whole demo.
 *  - Errors from the script (e.g., a target never mounted) are logged
 *    + swallowed so a buggy step doesn't deadlock the rest of the
 *    tour. The step's `completion` contract still drives advance.
 *  - A new step entry cancels any in-flight script via a `cancelled`
 *    flag captured in the effect cleanup, so back-to-back step
 *    transitions don't pile up overlapping cursor animations.
 */
function InProductWalkthroughOverlay({
  currentStep,
  onManualAdvance,
  onSkipStep,
  onExitTour,
  onBack,
  canGoBack,
}: InProductWalkthroughOverlayProps) {
  const cursorRef = useRef<BeakerBotCursorRef>(null);
  const body = getStep(currentStep);

  // Run the step's cursorScript on entry. Re-running when `currentStep`
  // changes is the desired contract: every step gets one fresh play.
  // The cleanup `cancelled` flag prevents an in-flight script from a
  // prior step continuing to drive the cursor after the user advanced.
  useEffect(() => {
    const stepBody = getStep(currentStep);
    if (!stepBody?.cursorScript) return;
    const ref = cursorRef.current;
    if (!ref) return;

    let cancelled = false;
    void (async () => {
      try {
        const actions = await stepBody.cursorScript!();
        if (cancelled) return;
        const liveRef = cursorRef.current;
        if (!liveRef) return;
        await liveRef.runScript(actions);
      } catch (err) {
        console.warn(
          `[TourController] cursor script for step "${currentStep}" failed:`,
          err,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentStep]);

  const showSpotlight = !!body?.targetSelector;

  return (
    <>
      {showSpotlight && body?.targetSelector && (
        <TourSpotlight target={body.targetSelector} />
      )}
      <BeakerBotCursor ref={cursorRef} />
      <TourBeakerBotOverlay
        step={body}
        onManualAdvance={onManualAdvance}
        onSkipStep={onSkipStep}
        onExitTour={onExitTour}
        onBack={onBack}
        canGoBack={canGoBack}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// P4: Modal-setup shell. Phase 1 Q1-Q6 mount surface
// ---------------------------------------------------------------------------

/**
 * Modal shell that renders the active Phase 1 setup step's body
 * (Welcome / Q1 / Q1a / Q1b / Q2..Q6). Mirrors the v3
 * `OnboardingWizardV3.tsx` chrome (modal portal, BeakerBot header,
 * Next / Back / Skip footer, persistent "I've got it from here" link)
 * but routes every transition through the v4 TourController so the
 * setup phase smoothly hands off to the in-product walkthrough at the
 * end of Q6.
 *
 * The shell owns:
 *   - the modal portal + backdrop
 *   - the BeakerBot header (pose from the descriptor)
 *   - the local `nextDisabled` gate the body controls via `setNextDisabled`
 *   - the Next / Back / Skip / Exit buttons + label resolution
 *
 * It does NOT own:
 *   - the step ordering (the controller's reducer + step machine handle
 *     advance / back / skip / exit)
 *   - the feature_picks persistence (the body writes through
 *     `patchSidecar`, which the parent of the controller wires up)
 *   - resume-state writes (P12 owns that, separately from this shell)
 *
 * The v3 "I've got it from here" inline confirm modal pattern is kept
 * so the user's safety net for skipping the whole walkthrough still
 * reads and behaves the same way.
 */
interface ModalSetupShellProps {
  stepId: TourStepId;
  descriptor: SetupStepDescriptor;
  sidecar: OnboardingSidecar | null;
  patchSidecar?: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
  onAdvance: () => void;
  onBack: () => void;
  onSkipStep: () => void;
  onExitTour: () => void;
}

function ModalSetupShell({
  stepId,
  descriptor,
  sidecar,
  patchSidecar,
  onAdvance,
  onBack,
  onSkipStep,
  onExitTour,
}: ModalSetupShellProps) {
  const [mounted, setMounted] = useState(false);
  const [nextDisabled, setNextDisabled] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const titleId = useId();

  // Stable patchSidecar for the body, falling back to a no-op when the
  // parent didn't pass one (matches the optional-prop contract above).
  // The no-op still resolves cleanly so the body's `await patchSidecar`
  // chain doesn't hang.
  const stableNoopPatch = useCallback(
    async (_patch: (cur: OnboardingSidecar) => OnboardingSidecar) => {
      // Intentional no-op: the parent didn't wire a patch hook. The
      // body still flips its local `pick` state for Q2-Q5 so the UI
      // doesn't feel dead; only persistence is skipped. P4 default for
      // tests + dev sandbox usage.
    },
    [],
  );
  const effectivePatch = patchSidecar ?? stableNoopPatch;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target is client-only; flip mounted after first client render.
    setMounted(true);
  }, []);

  // Reset the Next-disabled gate on every step transition. The body's
  // own useEffect calls setNextDisabled on mount; this reset prevents a
  // leftover `true` from a prior step blocking the new body's mount
  // window before its own effect runs.
  useEffect(() => {
    setNextDisabled(false);
  }, [stepId]);

  if (!mounted) return null;

  const { Component, title, pose } = descriptor;
  const isWelcome = stepId === "welcome";
  const nextLabel = isWelcome ? "Let's go" : "Next";

  const handleNext = () => {
    if (nextDisabled) return;
    onAdvance();
  };

  const handleGotItConfirm = () => {
    setShowSkipConfirm(false);
    onExitTour();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-tour-modal="v4-setup"
      data-tour-step={stepId}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[560px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden">
        <div className="px-7 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex-shrink-0"
              style={{ width: 120, height: 120 }}
            >
              <BeakerBot
                pose={pose}
                direction="right"
                className="w-full h-full text-sky-500"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Setup
                </span>
                <span className="text-[10px] font-mono text-gray-400">
                  {stepId}
                </span>
              </div>
              <h2
                id={titleId}
                className="mt-1 text-xl font-semibold text-gray-900"
              >
                {title}
              </h2>
            </div>
          </div>
        </div>

        <div className="px-7 py-6">
          <Component
            sidecar={sidecar}
            setNextDisabled={setNextDisabled}
            patchSidecar={effectivePatch}
          />
        </div>

        <div className="px-7 pb-4 pt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={isWelcome}
            className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Back
          </button>

          {!isWelcome && (
            <button
              type="button"
              onClick={onSkipStep}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Skip this step
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={nextDisabled}
            data-tour-next="setup"
            data-next-disabled={nextDisabled ? "true" : "false"}
            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {nextLabel}
          </button>
        </div>

        <div className="px-7 pb-4 border-t border-gray-100 pt-3 text-center">
          <button
            type="button"
            onClick={() => setShowSkipConfirm(true)}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
            aria-label="Skip walkthrough"
          >
            Skip walkthrough
          </button>
        </div>
      </div>

      {showSkipConfirm && (
        <SetupSkipConfirmModal
          onCancel={() => setShowSkipConfirm(false)}
          onConfirm={handleGotItConfirm}
        />
      )}
    </div>,
    document.body,
  );
}

/**
 * Inline confirm modal for the "I've got it from here" link. Mirrors
 * the v3 `SkipConfirmModal` shape so the user's safety net for skipping
 * the whole walkthrough still reads + behaves the same way.
 */
function SetupSkipConfirmModal({
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

/**
 * BeakerBot mascot floating bottom-right (above AppShell's FAB
 * cluster) + speech bubble above-left per L4. The bubble shows the
 * active step's `speech` content and, in the bottom-right action
 * row, two skip affordances: "Skip this step" (skips just the
 * current step) and "Skip walkthrough" (jumps to the cleanup grid).
 * Manual completion ("Got it, next") button is shown on the
 * bottom-left of the same row only when the step's body declares
 * manual completion.
 *
 * v4 polish (post-P11): both opt-out links moved to the bottom-right
 * of the bubble (previously "Skip walkthrough" sat at the top under
 * its old "I've got it from here" copy) so users see the two
 * skip paths together. Mascot size bumped from 80px to 120px and the
 * whole overlay anchor lifted above the FAB cluster.
 */
interface TourBeakerBotOverlayProps {
  step: TourStep | undefined;
  onManualAdvance: () => void;
  onSkipStep: () => void;
  onExitTour: () => void;
  /** v4 polish round 3: "← Back" link in the bubble's bottom-left.
   *  Hidden when `canGoBack` is false (user is at the first applicable
   *  step). Mirrors the existing skip links on the right edge of the
   *  same action row. */
  onBack: () => void;
  canGoBack: boolean;
}

function TourBeakerBotOverlay({
  step,
  onManualAdvance,
  onSkipStep,
  onExitTour,
  onBack,
  canGoBack,
}: TourBeakerBotOverlayProps) {
  if (!step) return null;

  const speechNode = typeof step.speech === "function" ? step.speech() : step.speech;

  const manualButtonLabel =
    step.completion.type === "manual"
      ? step.completion.buttonLabel ?? "Got it, next"
      : null;

  // Anchor position: bottom-right, but clear of AppShell's FAB cluster.
  // AppShell mounts a horizontal row of ~7 round 48px buttons at
  // `fixed bottom-6 right-6` (see AppShell.tsx ~line 306). With the
  // 24px bottom inset + 48px button height, that cluster occupies the
  // bottom 72px of the right edge. We anchor BeakerBot 24px above the
  // cluster's top (bottom: 96px) so the mascot + speech bubble sit
  // clearly above the row instead of overlapping the donation /
  // bug-report buttons. The right-6 (24px) inset matches the cluster
  // so the two elements visually align on the right edge.
  return (
    <div
      data-testid="tour-beakerbot-overlay"
      className="fixed right-6 z-[450] pointer-events-none flex flex-col items-end gap-2"
      style={{ maxWidth: 380, bottom: 96 }}
    >
      {/* Speech bubble. Above-and-to-the-left of the BeakerBot per L4.
          Pointer events are re-enabled here so the user can click
          Skip / Exit / Got it — the wrapper above is non-interactive so
          it doesn't block clicks anywhere else on the page-body. */}
      <div
        data-testid="tour-beakerbot-bubble"
        className="pointer-events-auto bg-white border border-gray-200 rounded-2xl shadow-xl p-4 text-sm text-gray-800"
        style={{ maxWidth: 340 }}
      >
        <div data-testid="tour-beakerbot-speech" className="leading-relaxed">
          {speechNode}
        </div>
        {/* Action row: three slots. Bottom-left holds the "← Back"
            link (v4 polish round 3 — surfaces controller.goBack() so a
            user who clicked off-target or deleted a step's prereq can
            rewind one step without restarting). Center holds the
            manual-advance CTA when the step declares one. Bottom-right
            holds the two skip affordances ("Skip this step" first per
            Grant's preferred wording, then "Skip walkthrough" — the
            cleanup-grid jump — separated by a middle-dot and slightly
            lighter weight to signal it's the more destructive option).
            The Back link styling matches "Skip this step" (text-gray-500
            underlined small) since both are tour-navigation
            affordances; "Skip walkthrough" stays slightly lighter
            (text-gray-400) to keep it visually deprioritized. */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            {canGoBack ? (
              <button
                type="button"
                onClick={onBack}
                className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                aria-label="Back"
              >
                {"← Back"}
              </button>
            ) : null}
          </div>
          {manualButtonLabel ? (
            <button
              type="button"
              onClick={onManualAdvance}
              className="text-xs font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-full px-3 py-1.5"
              aria-label={manualButtonLabel}
            >
              {manualButtonLabel}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <button
              type="button"
              onClick={onSkipStep}
              className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
              aria-label="Skip this step"
            >
              Skip this step
            </button>
            <span aria-hidden className="text-xs text-gray-300">
              {"·"}
            </span>
            <button
              type="button"
              onClick={onExitTour}
              className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
              aria-label="Skip walkthrough"
            >
              Skip walkthrough
            </button>
          </div>
        </div>
      </div>
      {/* BeakerBot mascot. Size bumped from 80px to 120px per Grant's
          v4 polish feedback so the mascot reads at a comparable
          presence to the speech bubble at typical viewport widths.
          Pointer events stay off so the mascot doesn't intercept
          clicks on the page body. */}
      <div className="pointer-events-none" style={{ width: 120, height: 120 }}>
        <BeakerBot
          pose={step.pose}
          className="w-full h-full text-sky-500"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { TOUR_STEPS, getStep };
export type { TourStep, TourStepId };
