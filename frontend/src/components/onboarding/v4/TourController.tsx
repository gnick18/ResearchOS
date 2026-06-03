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
import { usePathname, useRouter } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import BeakerBotCursor, {
  type BeakerBotCursorRef,
} from "@/components/BeakerBotCursor";
import Tooltip from "@/components/Tooltip";
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
// Cleanup retirement 2026-05-22 (Cleanup manager R2): Phase4CleanupStep
// and CleanupSummary were retired with the cleanup-grid removal. The
// terminal step is now `tour-goodbye` (steps/cleanup/TourGoodbyeStep.tsx)
// + an outro overlay mounted by V4MountForUser. Both Phase4CleanupStep
// and cleanup-execution.ts are kept in the repo with @deprecated JSDoc
// for git-history reference.
import type { TourStep, TourStepId } from "./step-types";
import { ensureViewportAnchor } from "./steps/walkthrough/lib/cursor-script";
import InputLockOverlay from "./InputLockOverlay";
import TourPageLock, {
  PAGE_LOCK_WRONG_CLICK_EVENT,
} from "./TourPageLock";
import {
  recordBranchChoice,
  resetBranchChoices,
} from "./steps/walkthrough/lib/branch-choices";
import { isTourSyntheticEscape } from "./steps/walkthrough/lib/synthetic-escape";

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
// Last-transition tracker (Grant 2026-05-22 back-step grace period)
// ---------------------------------------------------------------------------
//
// Module-level because the in-product walkthrough cursor-script effect
// (inside `InProductWalkthroughOverlay`, a separate component from the
// provider) needs to read the most recent action *type* — start /
// advance / goBack / skipStep — to decide whether to insert a 5 s pause
// before the script runs. Storing it on the reducer state would force
// the effect to re-fire on the read; a module-level let with a
// getter/setter pair keeps the effect's existing dep list intact.
// One global is safe because only one tour is active per browser tab.

export type TourTransitionType = "start" | "advance" | "goBack" | "skip";

/**
 * Wave 2 Fix 9/9 — strip preview-only query params from a search
 * string. Used by both the expectedRoute auto-navigate effect and
 * the popstate guard so a real (non-preview) tour run never
 * inherits ?wikiCapture=1 / ?wizard-preview=1 / ?wizardSeedStep /
 * ?tutorial from the user's URL bar. Preview mode no longer
 * depends on URL params after TourBootstrap's first hit (sticky
 * sessionStorage flag), so dropping them mid-tour is safe.
 *
 * Returns the filtered string in `?key=value&...` form (or empty
 * string when no params remain). Exported for tests.
 */
const PREVIEW_QUERY_PARAM_DENY_LIST = new Set([
  "wikiCapture",
  "wizard-preview",
  "wizardSeedStep",
  "tutorial",
]);

export function stripPreviewQueryParams(search: string): string {
  if (!search) return "";
  const queryStart = search.startsWith("?") ? 1 : 0;
  const params = new URLSearchParams(search.slice(queryStart));
  for (const key of Array.from(params.keys())) {
    if (PREVIEW_QUERY_PARAM_DENY_LIST.has(key)) {
      params.delete(key);
    }
  }
  const out = params.toString();
  return out.length > 0 ? `?${out}` : "";
}

/**
 * Wave 2 Fix 6/9 — pathname-settle helper.
 *
 * Awaits two requestAnimationFrame ticks after a router push so React
 * has time to commit the new route before the controller fires the
 * step's onEnter / cursorScript builds. Without this, onEnter and the
 * cursor-script builder read stale DOM (the old page's selectors)
 * because the router push schedules navigation asynchronously and the
 * effect's microtask runs before the next paint.
 *
 * Exported for tests that stub it. Pure: a no-op outside a browser.
 */
export function waitForPathnameSettle(
  expectedPathname: string | undefined,
  timeoutMs = 1500,
  exact = false,
): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!expectedPathname) return Promise.resolve();
  // Match contract from the expectedRoute effect: "/" is exact, other
  // values are prefix matches, unless the step opts into exact matching
  // (exactRoute), in which case any non-equal pathname fails the match.
  const matches = () =>
    expectedPathname === "/" || exact
      ? window.location.pathname === expectedPathname
      : window.location.pathname.startsWith(expectedPathname);
  if (matches()) {
    // Already on route — still yield two RAF ticks so a freshly-
    // pushed route has time to commit before downstream effects
    // sample the DOM.
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }
  return new Promise((resolve) => {
    let elapsed = 0;
    const tick = () => {
      if (matches() || elapsed >= timeoutMs) {
        resolve();
        return;
      }
      elapsed += 16;
      setTimeout(tick, 16);
    };
    tick();
  });
}

let lastTransitionType: TourTransitionType = "start";

export function getLastTourTransition(): TourTransitionType {
  return lastTransitionType;
}

export function setLastTourTransition(t: TourTransitionType): void {
  lastTransitionType = t;
}

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
  /** End the tour entirely — flips `currentStep` to null + `tourMode` to
   *  null so every tour-mode overlay (Phase4CleanupStep, setup modal,
   *  in-product walkthrough) unmounts on the next render. Called by the
   *  Phase 4 cleanup grid after onComplete / onSkip persist
   *  `wizard_completed_at` / `wizard_skipped_at`. Without this, the
   *  cleanup modal stays mounted with currentStep="phase4-cleanup" + an
   *  empty artifact list (resume_state was cleared by the persist) and
   *  shows the "No artifacts were created during this run" empty-state
   *  copy — the R4 "Finish re-summons modal" bug. */
  endTour(): void;
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
  /** Jump to a specific step id, overriding the step-machine's normal
   *  `getNextStep` traversal. Used by branch-completion steps (§6.7
   *  HE-2 markdown familiarity gate) where the step body's selected
   *  branch dictates the next id. The branch's nextStep is treated as
   *  authoritative — no gating recheck (the branch author already
   *  decided the destination). */
  branchTo(nextStep: TourStepId): void;
  /** List of step ids the user invoked `skipStep()` on, in order. Read
   *  by P12 when writing to `wizard_resume_state.skipped_steps`. */
  readonly skippedSteps: ReadonlyArray<TourStepId>;
  /** Configure the page-lock allow-list for user-action steps (Gantt
   *  redesign 2026-05-22). When `targets` is null, the lock disables.
   *  `wrongClickSpeech` is the "Oops, try X" copy flashed in the speech
   *  bubble when the user clicks something outside the allow-list. */
  setPageLock(
    targets: readonly string[] | null,
    wrongClickSpeech?: ReactNode,
  ): void;
  /** Convenience: same as `setPageLock(null)`. */
  clearPageLock(): void;
  /** Active page-lock allow-list. `null` when no lock is set. */
  readonly pageLockTargets: readonly string[] | null;
  /** Active wrong-click speech copy. Surfaced by the bubble when the
   *  user trips the lock. `null` when no flash is pending. */
  readonly pageLockWrongClickFlash: ReactNode | null;
  /** Active page-lock pill label (R1 fix-pass). Populated when the
   *  active step declares `pageLock.pillLabel`. Rendered by
   *  TourPageLock as a bottom-center reassurance pill. */
  readonly pageLockPillLabel: string | null;
  /** Wave 2 Fix 1/9: popstate toast visibility. True while the
   *  controller is surfacing the "tour is still running" toast after
   *  the user pressed browser Back. Auto-dismisses 4s after the
   *  popstate event. */
  readonly popstateToastVisible: boolean;
  /** Wave 2 Fix 1/9: explicit dismiss for the popstate toast. */
  dismissPopstateToast(): void;
  /** Wave 2 Fix 2/9: when the active step's target detached, the
   *  speech bubble swaps to a recovery line. The label is sourced
   *  from `step.recoveryHint?.buttonLabel` (or the generic fallback
   *  "the button you clicked before"). Null when no recovery is
   *  pending. */
  readonly targetDetachRecoveryLabel: string | null;
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
 *  "modal-setup". Lab steps → "lab". Everything else (universal +
 *  conditional walkthrough + the `tour-goodbye` terminal step) →
 *  "in-product-walkthrough" — the mode that triggers AppShell's
 *  top-nav gate per L23. Cleanup retirement 2026-05-22: the prior
 *  `phase4-cleanup` step + "cleanup" mode were retired in favor of
 *  the `tour-goodbye` walkthrough step + auto-cleanup overlay. */
function modeForStep(step: TourStepId | null): TourMode {
  if (step === null) return null;
  if (isSetupPhaseStep(step)) return "modal-setup";
  if (isLabPhaseStep(step)) return "lab";
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
  /** @deprecated Cleanup retirement 2026-05-22 (Cleanup manager R2).
   *  The Phase 4 cleanup grid was retired in favor of the
   *  `tour-goodbye` terminal step + auto-cleanup overlay. The auto-
   *  cleanup itself patches the sidecar (`wizard_completed_at`,
   *  cleared `wizard_resume_state`), so callers no longer need to
   *  provide this callback. Kept on the prop surface for back-compat
   *  with existing call sites; no longer invoked by the controller. */
  onComplete?: (summary: unknown) => void | Promise<void>;
  /** @deprecated Cleanup retirement 2026-05-22 (Cleanup manager R2).
   *  See `onComplete` JSDoc — the auto-cleanup writes a single
   *  `wizard_completed_at` regardless of how the user reached the
   *  terminal step, so the skipped-vs-completed branch is folded
   *  away. Kept on the prop surface for back-compat. */
  onSkip?: (summary: unknown) => void | Promise<void>;
}

export function TourControllerProvider({
  children,
  initialFeaturePicks = null,
  initialStep = null,
  sidecar = null,
  patchSidecar,
  username,
  // onComplete / onSkip remain on TourControllerProviderProps for back-
  // compat (see prop JSDoc — @deprecated, Cleanup retirement 2026-05-22)
  // but the provider no longer wires them to anything. The auto-cleanup
  // overlay owns the sidecar finalize patch end-to-end.
}: TourControllerProviderProps) {
  const router = useRouter();
  // R2 chip B Fix 1/3: subscribe to pathname so the expectedRoute
  // auto-correct effect re-fires when the user navigates away from
  // the expected route mid-step (e.g. clicks a demo project card
  // during `home-create-project`). Without pathname in the dep array,
  // the effect only re-evaluates on step change or pause toggles, so
  // a mid-step nav-escape left the tour parked pointing at UI that
  // wasn't on screen.
  const pathname = usePathname();
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

  // Page-lock state for user-action steps (Gantt redesign 2026-05-22).
  // The lock is a controller-level concern (not per-step) so a step's
  // body can mount/unmount the lock from its onEnter/onExit. The
  // wrong-click flash speech is a ReactNode so step bodies can interpolate.
  const [pageLockTargets, setPageLockTargetsState] = useState<
    readonly string[] | null
  >(null);
  const [pageLockSpeech, setPageLockSpeech] = useState<ReactNode | null>(null);
  const [pageLockWrongClickFlash, setPageLockWrongClickFlash] =
    useState<ReactNode | null>(null);
  // Pill label for the active page-lock (R1 fix-pass). Populated from a
  // step body's declarative `pageLock.pillLabel` slot via the
  // step-mount bridge effect below; TourPageLock renders it as a
  // bottom-center pill so the user has a visual cue that BeakerBot is
  // mid-beat (matches InputLockOverlay's "BeakerBot is demonstrating"
  // pill).
  const [pageLockPillLabel, setPageLockPillLabel] = useState<string | null>(
    null,
  );

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
    setLastTourTransition("start");
    // Reset the informational skipList alongside the START dispatch so an
    // in-session re-run (no reload) does not persist stale skips from the
    // first run into `wizard_resume_state.skipped_steps` via the P12 effect.
    // The reducer does not own skipList (it is a sibling useState), so we
    // must reset it here directly.
    setSkipList([]);
    dispatch({ type: "START", initialStep: initial ?? null });
  }, []);

  const advance = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.currentStep) return;
    const next = getNextStep(cur.currentStep, cur.featurePicks);
    setLastTourTransition("advance");
    dispatch({ type: "SET_STEP", nextStep: next, nextMode: modeForStep(next) });
  }, []);

  const branchTo = useCallback((nextStep: TourStepId) => {
    // Honor the branch's nextStep verbatim — no gating recheck. The
    // branch author already decided the destination. Treating it as
    // `advance` so the back-step grace marker stays consistent (a branch
    // click reads as forward progress, not a back-step).
    //
    // Inline-editor collapse (onboarding-inline bot 2026-06-02): the §6.7
    // HE-2 `hybrid-markdown-familiarity` branch (the prior example here)
    // was removed with the markdown deep-dive collapse, but `branchTo` +
    // `recordBranchChoice` stay generic and are still used by other
    // branch steps.
    setLastTourTransition("advance");
    // Record the branch choice so the step-machine's gate predicates can
    // read it for branch-gated steps.
    const cur = stateRef.current;
    if (cur.currentStep) {
      recordBranchChoice(cur.currentStep, nextStep);
    }
    dispatch({
      type: "SET_STEP",
      nextStep,
      nextMode: modeForStep(nextStep),
    });
  }, []);

  const goBack = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.currentStep) return;
    const prev = getPreviousStep(cur.currentStep, cur.featurePicks);
    if (prev === null) return;
    setLastTourTransition("goBack");
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
    setLastTourTransition("skip");
    dispatch({ type: "SET_STEP", nextStep: next, nextMode: modeForStep(next) });
  }, []);

  const exitTour = useCallback(() => {
    // "I've got it from here" (L10) — Cleanup retirement 2026-05-22:
    // jump straight to the new terminal `tour-goodbye` step instead of
    // the retired Phase 4 cleanup grid. The user clicks "Let's go" on
    // the goodbye speech, the outro overlay runs auto-cleanup in the
    // background, and the route lands on `/`. We still mark
    // `enteredCleanupViaSkip` for back-compat with any consumer that
    // reads the flag, though it has no effect on the new flow (the
    // auto-cleanup is identical whether the user reached tour-goodbye
    // via natural completion or via "I've got it from here").
    dispatch({ type: "MARK_CLEANUP_ENTERED_VIA_SKIP" });
    dispatch({
      type: "SET_STEP",
      nextStep: "tour-goodbye",
      nextMode: modeForStep("tour-goodbye"),
    });
  }, []);

  const pause = useCallback(() => dispatch({ type: "PAUSE" }), []);
  const resume = useCallback(() => dispatch({ type: "RESUME" }), []);
  const endTour = useCallback(() => {
    // Wipe any in-memory branch-choice recordings so a re-run starts
    // clean (R1 fix-pass P1 #7). The cache is module-level so it
    // outlives the controller's unmount without this reset.
    resetBranchChoices();
    dispatch({ type: "EXIT" });
  }, []);

  const setFeaturePicks = useCallback((picks: FeaturePicks | null) => {
    dispatch({ type: "SET_FEATURE_PICKS", picks });
  }, []);

  // Live-test sub-bot R2 (2026-05-21): V4MountForUser loads the sidecar
  // asynchronously, so on first render `initialFeaturePicks` is null
  // even when the user has real Q1-Q6 answers persisted. Without this
  // sync effect, the reducer captures null forever and every gated step
  // (lab cluster, Q1a/Q1b, conditionals) gates OUT because
  // `picks?.account_type` is undefined. Mirror prop → state on every
  // change so the controller picks up the loaded feature_picks the
  // moment the sidecar resolves.
  useEffect(() => {
    dispatch({ type: "SET_FEATURE_PICKS", picks: initialFeaturePicks ?? null });
  }, [initialFeaturePicks]);

  const noteInteraction = useCallback(
    () => dispatch({ type: "MARK_INTERACTION" }),
    [],
  );

  const setPageLock = useCallback(
    (targets: readonly string[] | null, wrongClickSpeech?: ReactNode) => {
      setPageLockTargetsState(targets);
      setPageLockSpeech(wrongClickSpeech ?? null);
      // Clear any pending flash on every reset; a new lock starts fresh.
      setPageLockWrongClickFlash(null);
    },
    [],
  );

  const clearPageLock = useCallback(() => {
    setPageLockTargetsState(null);
    setPageLockSpeech(null);
    setPageLockWrongClickFlash(null);
  }, []);

  // Clear the page-lock whenever the active step changes, THEN translate
  // any declarative `body.pageLock` config into the controller state.
  // Step bodies that use the imperative `setPageLock(...)` API still
  // work; this just plumbs the `pageLock: { allowList, pillLabel }`
  // declarative path the §6.7 HE-5/HE-6/HE-7 steps use.
  //
  // R1 fix-pass (Hybrid fix manager R1, 2026-05-22): without this
  // translation, declaring `pageLock` on a step body was dead code —
  // HE-5/HE-6/HE-7 leaked unlocked, so a stray user click into the
  // editor could race BeakerBot's typing.
  //
  // Allow-list normalisation: body bodies may declare allow-list values
  // as bare data-tour-target names (`"hybrid-editor-textarea"`) or as
  // wrapped CSS selectors (`'[data-tour-target="hybrid-editor-textarea"]'`).
  // `TourPageLock.isOnAllowList` only accepts the BARE form, so we
  // strip the wrapper here before handing the list to setPageLock.
  useEffect(() => {
    setPageLockTargetsState(null);
    setPageLockSpeech(null);
    setPageLockWrongClickFlash(null);
    setPageLockPillLabel(null);
    if (!state.currentStep) return;
    const body = getStep(state.currentStep);
    if (!body?.pageLock) return;
    const rawList = body.pageLock.allowList ?? [];
    // Strip `[data-tour-target="X"]` wrapper down to bare `X`. Bare
    // values pass through untouched.
    const normalised = rawList
      .map((sel) => {
        const m = sel.match(/^\[data-tour-target="([^"]+)"\]$/);
        return m ? m[1] : sel;
      })
      // Allow-list MUST be non-empty for TourPageLock to mount; if a
      // body declares `pageLock` with no allowList, we use a sentinel
      // empty array (lock-all-except-bubble). TourPageLock treats null
      // as "no lock", so any defined-but-empty array still triggers a
      // total lock.
      .filter((v) => v.length > 0);
    setPageLockTargetsState(normalised);
    // No wrong-click speech for declarative locks (the pillLabel is the
    // user-facing affordance). Imperative `setPageLock` callers still
    // pass speech directly via the second arg.
    setPageLockSpeech(null);
    setPageLockPillLabel(body.pageLock.pillLabel ?? null);
  }, [state.currentStep]);

  // Listen for wrong-click events from the TourPageLock and flash the
  // configured speech in the bubble for 2 seconds. The flash auto-clears
  // so the bubble returns to the step's normal speech.
  useEffect(() => {
    if (!pageLockTargets) return;
    if (typeof window === "undefined") return;
    const onWrongClick = () => {
      if (!pageLockSpeech) return;
      setPageLockWrongClickFlash(pageLockSpeech);
      // Auto-clear after 2s so the user can re-read the step's actual speech.
      window.setTimeout(() => setPageLockWrongClickFlash(null), 2000);
    };
    window.addEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, onWrongClick);
    return () => {
      window.removeEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, onWrongClick);
    };
  }, [pageLockTargets, pageLockSpeech]);

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
        // Wave 2 Fix 6/9: wait for pathname to settle on the step's
        // expectedRoute before calling onEnter. Without this, onEnter
        // can read stale page state (the previous step's surface)
        // because router.push schedules navigation async and effects
        // fire on currentStep change before the new route commits.
        await waitForPathnameSettle(
          body.expectedRoute,
          undefined,
          body.exactRoute === true,
        );
        if (cancelled) return;
        // Defensive note (cursor-nav race audit, 2026-05-25): the
        // __beakerBotCursorScriptRunning window flag set inside the
        // cursor-script effect below protects cursorScript-driven SPA
        // navigations from the auto-nav effect's bounce-back path.
        // onEnter hooks run OUTSIDE that effect, so the flag is NOT set
        // while onEnter executes. Today's onEnter bodies (notifications,
        // dependency tasks, home-widgets Done toggle) do not navigate;
        // if a future hook needs router.push, set the flag true before
        // the push and clear it after (or move the nav into the
        // cursor-script effect). See commit 62f94d59 for the §6.1 shape.
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
  // §6.1 nav fix (2026-05-25): track the step the auto-nav effect last
  // observed so we can tell apart "step changed" (push on entry) from
  // "pathname changed mid-step" (R2 chip B nav-escape). The
  // cursor-script-running guard only applies to the latter — on step
  // entry, the cursor flag may already be true (set synchronously by
  // the child overlay's cursor-script effect on the same render) but
  // we still want the auto-nav push to fire so the step lands on the
  // right route. Mid-step pathname changes are the bounce-back case
  // (§6.2 NAV's cursor click navigates forward and the guard suppresses
  // the bounce).
  const lastAutoNavStepRef = useRef<TourStepId | null>(null);
  useEffect(() => {
    if (!state.currentStep || state.paused) return;
    const body = getStep(state.currentStep);
    if (!body?.expectedRoute) {
      lastAutoNavStepRef.current = state.currentStep;
      return;
    }

    // SSR guard. Tests under jsdom still have `window`; the guard is
    // here for the rare case of the controller mounting during an
    // SSR hydration before window is defined.
    if (typeof window === "undefined") return;
    const current = window.location.pathname;
    const expected = body.expectedRoute;

    // Did the step change since the last auto-nav fire? Capture BEFORE
    // we mutate the ref so the guard below can branch on it.
    const stepChanged = lastAutoNavStepRef.current !== state.currentStep;
    lastAutoNavStepRef.current = state.currentStep;

    // Match contract: prefix match (`startsWith`) for everything EXCEPT
    // the home route. `/` would prefix-match every path, which would
    // mean home-rooted steps never auto-navigate from a sub-page (the
    // exact bug Grant hit, where refreshing on /workbench/projects/<id>
    // while on a home-rooted step never moved him back to home). Treat
    // `/` as an exact-match route and any other path as a prefix. A step
    // can also opt into exact matching via `exactRoute` so a deeper
    // sub-route does not count as "already there" (the
    // workbench-create-experiment-open case, where /workbench/projects/<id>
    // prefix-matched /workbench and suppressed the nav back to the list).
    const useExact = expected === "/" || body.exactRoute === true;
    const alreadyOnRoute = useExact
      ? current === expected
      : current.startsWith(expected);
    if (alreadyOnRoute) return;

    // §6.1 nav fix (2026-05-25): when BeakerBot's cursor script is
    // mid-run AND the step hasn't changed since the last auto-nav
    // observation, the pathname change is the cursor's own navigation —
    // not the user wandering off — because the InputLockOverlay blocks
    // user clicks while the cursor drives. The §6.2 NAV step is the
    // canonical case: it declares `expectedRoute: "/"` for refresh-
    // resilience, then its cursor click pushes the user into
    // `/workbench/projects/<id>`. Without this guard, the pathname-dep
    // re-fire would bounce the user back to "/" the moment the cursor
    // arrived at the project route, stranding the tour on home while
    // §6.2 PROSE tried to find the project-overview-textarea anchor
    // (which only mounts on the project route) and triggering the
    // target-detach recovery hint inappropriately.
    //
    // The `stepChanged` gate matters: on a step transition into a
    // cursor-script step from another cursor-script step, the cursor
    // flag may already be true (the child overlay's effect runs first
    // on the same render). Without the gate, the legitimate step-entry
    // push would be suppressed. User-driven nav-escapes (the R2 chip B
    // case) still correct because the cursor isn't running during a
    // user-action step (the predecessor step's cursor flag was cleared
    // on its exit).
    if (
      !stepChanged &&
      typeof window !== "undefined" &&
      (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
        .__beakerBotCursorScriptRunning
    ) {
      return;
    }

    // §6.2 click-bypass R2 root-cause fix (2026-05-26).
    // The `__beakerBotCursorScriptRunning` guard above ONLY suppresses
    // the bounce while the cursor's runScript is still in-flight. But
    // `router.push(...)` from inside a click handler is ASYNC: the
    // pathname change useEffect observes the new path only AFTER
    // React commits the navigation, which happens AFTER the
    // synchronous cursor-script `finally` block clears
    // `__beakerBotCursorScriptRunning`. Result: by the time this
    // effect fires on the cursor-driven pathname change, the running
    // flag is already false, the guard passes through, and the auto-
    // nav effect pushes the user back to `expectedRoute` — undoing
    // the navigation the cursor's click just triggered. The §6.2 NAV
    // step is the canonical case: cursor click pushes to
    // `/workbench/projects/<id>`, then this effect immediately pushes
    // back to `/`, the user never leaves home, the InputLockOverlay
    // stays mounted because the next step's overlay-mount cycle never
    // completes, and the watchdog finally releases it 30s later.
    //
    // The pending-navigation flag is set in `safeNavClickAction` (and
    // any other cursor-script primitive that initiates a navigation)
    // and persists across the cursor script's resolution. It's
    // consumed here on the first pathname change the auto-nav effect
    // sees so the cursor's nav can land without bounce-back. A
    // separate timeout (in TourController's cursor-script effect)
    // safety-drains the flag in case the click never actually
    // produced a navigation (defensive — shouldn't normally fire).
    const w = window as unknown as {
      __beakerBotCursorPendingNavigation?: boolean;
    };
    if (!stepChanged && w.__beakerBotCursorPendingNavigation) {
      // Consume the flag — this pathname change was the cursor's
      // intended nav. Subsequent pathname changes for the same step
      // (e.g. the user wandering off after the cursor finished) should
      // still be corrected by the auto-nav push.
      w.__beakerBotCursorPendingNavigation = false;
      return;
    }

    // Preserve query params on the auto-nav push (live-test R2 fix
    // 2026-05-21). Originally we carried ALL existing search params
    // through so fixture-mode (?wikiCapture=1, ?wizard-preview=1,
    // ?wizardSeedStep) survived navigation.
    //
    // Wave 2 Fix 9/9: drop the preview-only params from the carried
    // search string. Real (non-preview) tour runs were inheriting
    // these from a developer URL bar entry, making the production
    // URL look like ?wikiCapture=1 mid-tour. Preview mode still
    // works because TourBootstrap sets sticky session flags
    // (researchos:v4-preview-active) on the first hit; the URL is
    // no longer the source of truth for the preview gate after the
    // initial bootstrap.
    const filteredSearch = stripPreviewQueryParams(window.location.search);
    router.push(`${expected}${filteredSearch}`);
    // R2 chip B Fix 1/3: pathname is in the dep array so a mid-step
    // nav-escape (user clicks a project card while on a home-rooted
    // step) re-fires the auto-correct. Without it, the effect only
    // re-runs on step transitions and the tour stays parked on the
    // wrong route with no recovery.
  }, [state.currentStep, state.paused, router, pathname]);

  // Wave 2 Fix 1/9: popstate guard.
  // When the user hits the browser Back button during an active tour
  // step that declares an `expectedRoute`, the tour ends up rendering
  // against a route the step body did not anticipate (BeakerBot keeps
  // pointing at things that no longer exist on screen). Re-push the
  // expected route so the tour stays anchored, then surface a toast
  // telling the user the tour is still running with an inline
  // "Exit Tour" button to cleanly end the run. The sacrificial
  // history entry pushed by TourBootstrap on tour start ensures the
  // FIRST Back from step 0 still has somewhere to land (same URL,
  // empty state), so this listener doesn't fire on the first Back.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!state.currentStep || state.paused) return;
    const onPopState = () => {
      if (!stateRef.current.currentStep) return;
      const cur = stateRef.current;
      const body = getStep(cur.currentStep!);
      if (!body?.expectedRoute) return;
      const expected = body.expectedRoute;
      const pathname = window.location.pathname;
      const useExact = expected === "/" || body.exactRoute === true;
      const matched = useExact
        ? pathname === expected
        : pathname.startsWith(expected);
      if (matched) return;
      // Carry the same query-param contract as the expectedRoute
      // auto-navigate effect above — strip preview-only params
      // (Wave 2 Fix 9/9).
      const filteredSearch = stripPreviewQueryParams(window.location.search);
      router.push(`${expected}${filteredSearch}`);
      setPopstateToastVisible(true);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [state.currentStep, state.paused, router]);

  // Wave 2 Fix 1/9: sacrificial history entry. Push a sentinel
  // history entry the moment the tour transitions from inactive
  // (currentStep == null) to active. The first Back press from the
  // first step then pops the sentinel and lands on the same URL with
  // the same query string; the popstate listener above sees pathname
  // already matches expected and stays quiet. Without the sentinel,
  // pressing Back at step 0 would pop into whatever entry sat
  // beneath the tour's start (often the previous page), triggering
  // a noisy re-push immediately on launch.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const active = !!state.currentStep;
    if (active && !wasActiveRef.current) {
      try {
        window.history.pushState(
          { tourSentinel: true },
          "",
          window.location.href,
        );
      } catch {
        // Some browsers reject pushState on file:// or with a
        // mismatched origin URL; swallow so a sandboxed launch
        // doesn't crash the tour.
      }
    }
    wasActiveRef.current = active;
  }, [state.currentStep]);

  // Wave 2 Fix 2/9: target-detach watcher state. The label is the
  // resolved recovery copy ("Click X to re-open and try again"); null
  // when the target is present (or there's no target at all). The
  // step-change effect below tears down the observer + resets the
  // state on every transition so a stale detach from the prior step
  // never bleeds into the next.
  //
  // Bug-squad fix bot 2026-05-26 (Bug 5: stale bubble + caption render
  // bleed). The label was previously a bare `string | null`. On a step
  // transition the effect's `setTargetDetachRecoveryLabel(null)` is
  // queued by an effect that runs AFTER the first render with the new
  // `state.currentStep`, so for one frame the bubble's flashSpeech
  // showed the PRIOR step's recovery copy ("Looks like that closed...")
  // while the caption already read the NEW step's prose. Pairing the
  // label with the step id it was set against lets the consumer ignore
  // a stale value at render time; the second commit (when the new
  // effect clears state) then unifies the two without the visible
  // bleed.
  const [targetDetachRecovery, setTargetDetachRecovery] = useState<{
    label: string;
    stepId: TourStepId;
  } | null>(null);
  useEffect(() => {
    setTargetDetachRecovery(null);
    if (typeof document === "undefined") return;
    if (!state.currentStep || state.paused) return;
    const body = getStep(state.currentStep);
    if (!body) return;
    const selector = body.targetSelector;
    const owningStepId = state.currentStep;
    // panel copy polish 2026-05-26: the prior fallback "the button you
    // clicked before" had no referent — the last button most users
    // clicked was the tour's own Next. Steps should declare their own
    // recoveryHint; this generic fallback now reads as a hint to retry
    // whatever opened the previous surface.
    const hint = body.recoveryHint?.buttonLabel ?? "the button that opened that surface";
    const isLabStep = isLabPhaseStep(state.currentStep);
    // R4 Lab Mode retirement 2026-05-23: the prior `lab-mode-tour:close`
    // event subscription (which paired with the DemoLabModeViewer
    // overlay) is gone alongside the overlay itself. The new Lab
    // Overview tour walks the user's real `/lab-overview` widget canvas,
    // so there's no overlay to detect dismissal of. The MutationObserver
    // path below still catches target-detach (e.g. the user closes a
    // popup that contained the spotlight target) on every step.

    let mo: MutationObserver | null = null;
    let detached = false;
    // Has the spotlight target EVER been present during this step? A
    // target that has not mounted yet (step still entering, onEnter still
    // spawning its surface) reading "absent" is not a close — only a
    // target that appeared and THEN vanished is. Without this guard the
    // MutationObserver (which fires on the very first DOM mutation, well
    // before the 200ms initial-settle timer) reports a false detach the
    // instant any unrelated mutation happens during step entry.
    let seenPresent = false;
    // Debounce handle for the absence -> recovery decision (see
    // confirmDetach below). Cleared on re-presence, on the completion
    // event, and on teardown.
    let recheckTimer: number | null = null;
    // Grant feedback 2026-05-26 (methods-category demo false recovery):
    // when BeakerBot's own cursor script's terminal action closes the
    // surface containing the spotlight target (e.g. clicking "Create
    // Empty" on the New Category modal unmounts the name input), the
    // MutationObserver below sees the target vanish and fires the
    // "Looks like that closed. Click X to re-open" recovery copy — even
    // though BeakerBot's the one who closed it. Track whether the
    // cursor script ran during THIS step's lifetime; if it did, any
    // subsequent detach is the demo's expected terminal effect, not a
    // user mis-click. The user can still advance manually via
    // "Got it, next" (universal pacing rule); the recovery copy was
    // only ever for unsolicited surface closes.
    let cursorScriptRanThisStep = false;

    // USER_ACTION completion-event suppression (Grant 2026-05-27).
    // When a step's manual-advance is gated on a `disabledUntilEvent`
    // (e.g. workbench-create-experiment-submit waits on
    // `tour:experiment-created`), the user clicking the spotlighted
    // button is what fires that event AND closes the surface the button
    // lived in (the New Experiment modal unmounts on a successful
    // create). Without this guard the MutationObserver sees the button
    // detach and fires "Looks like that closed, re-open and try again"
    // even though the user did exactly what was asked. Track whether the
    // completion event has fired; once it has, any subsequent detach is
    // the expected success effect, not a mis-click. Mirrors the
    // cursorScriptRanThisStep suppression for the BeakerBot-demo case.
    let completionEventFired = false;
    const completionEvent =
      body.completion.type === "manual"
        ? body.completion.disabledUntilEvent
        : undefined;
    const onCompletionEvent = () => {
      completionEventFired = true;
      // Cancel a pending debounced detach so the success-close can't fire
      // recovery after the event lands.
      if (recheckTimer !== null) {
        window.clearTimeout(recheckTimer);
        recheckTimer = null;
      }
      // Clear any recovery hint that may have raced in just before the
      // event landed, so a transient false-positive doesn't linger.
      setTargetDetachRecovery(null);
    };
    if (completionEvent && typeof window !== "undefined") {
      window.addEventListener(completionEvent, onCompletionEvent);
    }

    // Confirm a suspected detach after a settle delay. A target can
    // vanish for a frame or two during a re-render, or when a SIBLING
    // surface closes and the page underneath reflows — e.g. a step's own
    // onExit closes BeakerBot's shared-experiment popup, and the gantt
    // bar the NEXT step spotlights is briefly replaced as React
    // reconciles. Only fire the "Looks like that closed" recovery if the
    // target is STILL gone after the settle, which separates a genuine
    // user-close from transient churn. Grant 2026-05-28 (gantt-share
    // false recovery after BeakerBot closes the popup for the user).
    const confirmDetach = () => {
      recheckTimer = null;
      if (!selector || detached) return;
      if (cursorScriptRanThisStep || completionEventFired) return;
      const wNow =
        typeof window !== "undefined"
          ? (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
          : null;
      if (wNow?.__beakerBotCursorScriptRunning) {
        cursorScriptRanThisStep = true;
        return;
      }
      if (!document.querySelector(selector)) {
        detached = true;
        setTargetDetachRecovery({ label: hint, stepId: owningStepId });
      }
    };

    const evaluate = () => {
      if (!selector) return;
      // Suppress while BeakerBot is actively driving — the modal-close
      // click is the script's own action, the resulting detach is
      // expected. Remember it ran so subsequent post-completion
      // detaches stay suppressed too.
      const w =
        typeof window !== "undefined"
          ? (window as unknown as {
              __beakerBotCursorScriptRunning?: boolean;
            })
          : null;
      if (w?.__beakerBotCursorScriptRunning) {
        cursorScriptRanThisStep = true;
        return;
      }
      if (cursorScriptRanThisStep) return;
      // USER_ACTION success path: the completion-gating event fired, so
      // the surface closing is the expected result of the user's click.
      if (completionEventFired) return;
      const present = !!document.querySelector(selector);
      if (present) {
        seenPresent = true;
        if (recheckTimer !== null) {
          window.clearTimeout(recheckTimer);
          recheckTimer = null;
        }
        if (detached) {
          detached = false;
          setTargetDetachRecovery(null);
        }
        return;
      }
      // Target absent. Ignore until it has appeared at least once (a
      // not-yet-mounted target is not a "close"), and debounce so a
      // transient re-render / sibling-surface-close gap does not fire.
      if (!seenPresent || detached || recheckTimer !== null) return;
      recheckTimer = window.setTimeout(confirmDetach, 400);
    };

    if (selector) {
      // Defer the first evaluate by a tick so the step's onEnter /
      // cursor-script effects have a chance to mount whatever they
      // need first. Without this the watcher races the step entry
      // and reports a false-positive detach on every step change.
      const initialTimer = window.setTimeout(evaluate, 200);
      if (typeof MutationObserver !== "undefined") {
        mo = new MutationObserver(() => {
          evaluate();
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }
      return () => {
        window.clearTimeout(initialTimer);
        if (recheckTimer !== null) window.clearTimeout(recheckTimer);
        mo?.disconnect();
        if (completionEvent && typeof window !== "undefined") {
          window.removeEventListener(completionEvent, onCompletionEvent);
        }
      };
    }

    // Suppress unused-variable warning on isLabStep — kept around in
    // case a future lab-only target-detach contract reappears (R5 may
    // need it for the `/lab` deletion sweep).
    void isLabStep;

    // No-selector path still has to tear down the completion-event
    // listener if one was attached above.
    return () => {
      if (completionEvent && typeof window !== "undefined") {
        window.removeEventListener(completionEvent, onCompletionEvent);
      }
    };
  }, [state.currentStep, state.paused]);

  // Render-time stale-step guard (Bug 5 fix). The flashSpeech consumer
  // reads `targetDetachRecoveryLabel`; we expose null when the captured
  // state belongs to a previous step so the one-frame bleed window
  // between SET_STEP commit and the cleanup effect's setState(null)
  // doesn't show the prior step's recovery copy on the new step's
  // bubble.
  const targetDetachRecoveryLabel =
    targetDetachRecovery && targetDetachRecovery.stepId === state.currentStep
      ? targetDetachRecovery.label
      : null;

  // Popstate toast visibility — flipped on by the popstate listener,
  // auto-dismisses 4s later, also cleared on tour end / step change.
  const [popstateToastVisible, setPopstateToastVisible] = useState(false);
  useEffect(() => {
    if (!popstateToastVisible) return;
    const timer = window.setTimeout(() => setPopstateToastVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [popstateToastVisible]);
  // Clear toast on tour end so it doesn't linger after exitTour.
  useEffect(() => {
    if (!state.currentStep) setPopstateToastVisible(false);
  }, [state.currentStep]);

  // Expose the current step id on document.body so global CSS rules can
  // target it. Used by steps that need a secondary "soft" affordance to
  // pulse alongside the primary spotlight, eg. §6.3 silence highlights
  // both the per-row checkmark AND the "Mark all read" header link (the
  // primary spotlight covers one, CSS handles the other).
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (state.currentStep && !state.paused) {
      document.body.dataset.tourStep = state.currentStep;
    } else {
      delete document.body.dataset.tourStep;
    }
    return () => {
      if (typeof document !== "undefined") delete document.body.dataset.tourStep;
    };
  }, [state.currentStep, state.paused]);

  // -------------------------------------------------------------------
  // Memoized context value
  // -------------------------------------------------------------------

  const dismissPopstateToast = useCallback(() => {
    setPopstateToastVisible(false);
  }, []);

  const value = useMemo<TourControllerValue>(
    () => ({
      ...state,
      skippedSteps: skipList,
      start,
      advance,
      goBack,
      skipStep,
      exitTour,
      endTour,
      pause,
      resume,
      setFeaturePicks,
      noteInteraction,
      noteEventFired,
      noteManualAdvance,
      setPageLock,
      clearPageLock,
      pageLockTargets,
      pageLockWrongClickFlash,
      pageLockPillLabel,
      branchTo,
      popstateToastVisible,
      dismissPopstateToast,
      targetDetachRecoveryLabel,
    }),
    [
      state,
      skipList,
      start,
      advance,
      goBack,
      skipStep,
      exitTour,
      endTour,
      pause,
      resume,
      setFeaturePicks,
      noteInteraction,
      noteEventFired,
      noteManualAdvance,
      setPageLock,
      clearPageLock,
      pageLockTargets,
      pageLockWrongClickFlash,
      pageLockPillLabel,
      branchTo,
      popstateToastVisible,
      dismissPopstateToast,
      targetDetachRecoveryLabel,
    ],
  );

  return (
    <TourControllerContext.Provider value={value}>
      {children}
      <TourOverlay
        sidecar={sidecar}
        patchSidecar={patchSidecar}
        username={username}
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
  // Cleanup retirement 2026-05-22 (Cleanup manager R2): onComplete /
  // onSkip props removed from TourOverlay — the auto-cleanup overlay
  // (TourGoodbyeOverlay, mounted by V4MountForUser) owns the sidecar
  // finalize patch.
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
}: TourOverlayProps) {
  const controller = useTourController();

  if (!controller.currentStep || controller.paused) return null;

  // Wave 2 Fix 1/9: popstate toast — rendered alongside whichever phase
  // surface owns the current step. The toast itself short-circuits to
  // null when `popstateToastVisible` is false.
  const toast = (
    <PopstateBackToast
      visible={controller.popstateToastVisible}
      onExit={() => {
        controller.dismissPopstateToast();
        controller.exitTour();
      }}
      onDismiss={controller.dismissPopstateToast}
    />
  );

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
      <>
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
        {toast}
      </>
    );
  }

  // Phase 4 cleanup-grid retirement 2026-05-22 (Cleanup manager R2):
  // the prior `tourMode === "cleanup"` branch that rendered the full-
  // screen Phase4CleanupStep grid has been removed. The terminal step
  // is now `tour-goodbye` (a standard walkthrough step); the auto-
  // cleanup + animation outro lives in a sibling overlay component
  // (`TourGoodbyeOverlay` mounted by `V4MountForUser`) that survives
  // the tour state going null. No special-case rendering needed here.

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
    <>
      <InProductWalkthroughOverlay
        currentStep={controller.currentStep}
        onManualAdvance={controller.noteManualAdvance}
        onSkipStep={controller.skipStep}
        onExitTour={controller.exitTour}
        onBack={controller.goBack}
        onBranchTo={controller.branchTo}
        canGoBack={!isAtFirstStep}
      />
      {toast}
    </>
  );
}

// ---------------------------------------------------------------------------
// Wave 2 Fix 1/9: Popstate-back toast
// ---------------------------------------------------------------------------

interface PopstateBackToastProps {
  visible: boolean;
  /** Exit Tour button — dismiss the toast and end the tour. */
  onExit: () => void;
  /** Auto-dismiss (timer fired). Surfaced so the close-X can call it. */
  onDismiss: () => void;
}

/**
 * Wave 2 Fix 1/9 — small bottom-center toast that flashes when the user
 * presses browser Back during an active tour. The controller's popstate
 * handler re-pushes the expected route; this toast tells the user the
 * tour is still running and offers a clean exit hatch.
 *
 * Auto-dismisses 4s after mount (timer lives in the controller). Inline
 * "Exit Tour" button calls `controller.exitTour()` via the parent prop.
 */
function PopstateBackToast({
  visible,
  onExit,
  onDismiss,
}: PopstateBackToastProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only mount detection so the portal target is safe.
    setMounted(true);
  }, []);
  if (!mounted || !visible) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="tour-popstate-toast"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        color: "white",
        fontSize: 13,
        fontWeight: 500,
        padding: "10px 14px 10px 16px",
        borderRadius: 12,
        boxShadow: "0 6px 16px rgba(0, 0, 0, 0.25)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        zIndex: 460,
        pointerEvents: "auto",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span>The tour is still running. Click Exit Tour to end early.</span>
      <button
        type="button"
        onClick={onExit}
        data-testid="tour-popstate-toast-exit"
        style={{
          backgroundColor: "#0ea5e9",
          color: "white",
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 12px",
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
        }}
      >
        Exit Tour
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        data-testid="tour-popstate-toast-dismiss"
        style={{
          background: "transparent",
          color: "rgba(255,255,255,0.7)",
          border: "none",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 2,
        }}
      >
        ×
      </button>
    </div>,
    document.body,
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
  /** §6.7 HE-2 branch-completion handler. The speech bubble renders one
   *  button per branch; clicking dispatches `branchTo(nextStep)` to jump
   *  directly to the branch's destination instead of the
   *  step-machine's default forward traversal. */
  onBranchTo: (nextStep: TourStepId) => void;
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
  onBranchTo,
  canGoBack,
}: InProductWalkthroughOverlayProps) {
  const cursorRef = useRef<BeakerBotCursorRef>(null);
  const body = getStep(currentStep);
  // Mirror of "BeakerBotCursor is currently driving an animation."
  // Flipped true right before `runScript`, false after the script
  // resolves OR when the step transitions (cleanup cancels in-flight
  // scripts). Drives the InputLockOverlay so the user can't scroll
  // or click random buttons while the cursor's pre-computed coordinates
  // are still valid — per Grant's "block the user from kind of clicking
  // anything or scrolling anything on the screen when BeakerBot is
  // actively typing using the cursor" mandate (2026-05-21).
  const [cursorActive, setCursorActive] = useState(false);
  // ESC listener regression fix (2026-05-26 explorer break-bot). When
  // the user hits Escape during a spotlight step, the prior ESC
  // handler called `onExitTour()` directly, which jumped silently
  // to `tour-goodbye` and skipped every remaining beat. That looked
  // identical to a buggy fast-forward (no confirm, no toast, no
  // visible action). We now open the same confirm modal the
  // modal-setup phase uses for its "Skip walkthrough" link, so an
  // accidental Escape is recoverable and an intentional Escape still
  // routes to the original exit path via the confirm's primary
  // button. The wedge-recovery use case the original ESC listener
  // added for (commit 02f072d3) is still served, the user just
  // confirms one click before exiting.
  const [showEscSkipConfirm, setShowEscSkipConfirm] = useState(false);

  // Run the step's cursorScript on entry. Re-running when `currentStep`
  // changes is the desired contract: every step gets one fresh play.
  // The cleanup `cancelled` flag prevents an in-flight script from a
  // prior step continuing to drive the cursor after the user advanced.
  useEffect(() => {
    const stepBody = getStep(currentStep);
    if (!stepBody?.cursorScript) {
      // No cursor demo on this step — the input lock must stay off so
      // user-action steps (e.g. home-create-project) remain interactive.
      setCursorActive(false);
      // §6.1 nav fix (2026-05-25): mirror the cursorActive flip onto
      // the window so the auto-nav effect in TourControllerProvider
      // can short-circuit a pathname-dep bounce while the cursor is
      // mid-script. See the auto-nav effect for the consumer side.
      if (typeof window !== "undefined") {
        (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
          .__beakerBotCursorScriptRunning = false;
      }
      return;
    }
    const ref = cursorRef.current;
    if (!ref) return;

    let cancelled = false;
    // Wave 2 Fix 3/9: per-effect AbortController. The cursor's
    // runScript receives the signal so it short-circuits at the next
    // action boundary when the step exits while a long script is
    // still queued. Aborts also wake abortable sleep() / pause(),
    // collapsing multi-second waits into microtasks.
    const abortController = new AbortController();
    // Wave 2 Fix 5/9: lock input BEFORE the cursor-script build runs.
    // The build can perform async DOM lookups (waitForElement, modal
    // mount waits) that take hundreds of ms. Without this early
    // activation, a user could click the spotlight target between
    // step entry and runScript start, racing the cursor's
    // pre-computed coordinates. The cleanup below still flips it off
    // on step exit, and the lock-during-build window is invisible if
    // no cursor is currently running.
    setCursorActive(true);
    // §6.1 nav fix (2026-05-25): mirror cursorActive onto a window
    // flag so the auto-nav effect (in TourControllerProvider) can
    // suppress its pathname-dep bounce while the cursor is driving.
    // Without this, a cursor-driven navigation (e.g. §6.2 NAV clicks
    // a project card → router.push to /workbench/projects/<id>) gets
    // bounced back to expectedRoute (`/` for §6.2 NAV) because the
    // auto-nav effect runs on the pathname change. See the consumer
    // side for the full rationale.
    if (typeof window !== "undefined") {
      (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
        .__beakerBotCursorScriptRunning = true;
    }
    // §6.2 NAV escape hatch manager 2026-05-23 — cursor-lock watchdog.
    // If a cursor script hangs (waitForElement that never resolves on
    // a stale anchor, a click that doesn't navigate so a follow-on
    // event never fires, a callback that awaits forever, etc.), the
    // InputLockOverlay stays mounted indefinitely with
    // pointer-events: auto and the user is wedged behind a 5%-dim
    // lock with no way out except clicking Skip walkthrough in the
    // speech bubble. 30s is the ceiling: every legitimate cursor
    // demo in the v4 walkthrough today completes well under that
    // (the longest is the §6.4b PCR demo at ~15s); 30s leaves
    // ~2x headroom so a slow CI machine or a momentary GC pause
    // doesn't trip the watchdog spuriously. On fire, we
    // setCursorActive(false) (releases the lock) AND abort the
    // controller (wakes any parked abortable-sleep / pause inside
    // the runScript queue so the for-loop short-circuits at the
    // next action boundary). Both the success/error finally paths
    // and the effect cleanup clear the timer so a normally-
    // resolving script doesn't fire the watchdog late.
    const CURSOR_LOCK_WATCHDOG_MS = 30_000;
    let watchdogFired = false;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    if (typeof window !== "undefined") {
      watchdogTimer = setTimeout(() => {
        watchdogFired = true;
        watchdogTimer = null;
        console.warn(
          `[TourController] cursor-lock watchdog fired after ${CURSOR_LOCK_WATCHDOG_MS}ms on step "${currentStep}"; force-releasing InputLockOverlay`,
        );
        // Abort first so an in-flight runScript collapses any
        // parked abortable sleeps and exits the for-loop at the
        // next boundary. Then flip cursorActive off so the
        // overlay unmounts immediately (the in-flight script's
        // own finally would do this too, but we don't want to
        // wait on it — the user is stuck NOW). §6.1 nav fix: also
        // clear the window flag so a subsequent pathname change is
        // not suppressed by a stuck-on flag from a hung script.
        abortController.abort();
        if (!cancelled) {
          setCursorActive(false);
          if (typeof window !== "undefined") {
            (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
              .__beakerBotCursorScriptRunning = false;
          }
        }
      }, CURSOR_LOCK_WATCHDOG_MS);
    }
    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    void (async () => {
      try {
        // Wave 2 Fix 6/9: wait for pathname to settle BEFORE the
        // cursor-script builder runs. Selector resolutions inside the
        // builder (waitForElement etc) race the route commit
        // otherwise. The helper is a no-op when the step has no
        // expectedRoute or when the pathname already matches.
        await waitForPathnameSettle(
          stepBody.expectedRoute,
          undefined,
          stepBody.exactRoute === true,
        );
        if (cancelled) return;
        // Build the action list FIRST. Some step bodies (e.g. the LC
        // demo) silent-pre-click a tile inside the builder so the
        // anchor wrapper mounts; running the anchor scroll before the
        // builder mounts would log a "selector did not mount" warn.
        const actions = await stepBody.cursorScript!();
        if (cancelled) return;

        // Viewport-anchor scroll (Bug A, sub-bot 2026-05-21). Ensures
        // the LARGE surface (the whole PCR builder card / LC gradient
        // card / methods modal) is visible BEFORE the cursor animates.
        // Without this, `ensureInViewport` inside the cursor-script
        // helpers only guarantees the small click target on screen —
        // the user may be looking at a builder whose top is cut off.
        if (stepBody.viewportAnchor) {
          await ensureViewportAnchor(stepBody.viewportAnchor);
          if (cancelled) return;
        }

        // Back-step grace period (Grant 2026-05-22): if the user just
        // clicked Back, pause 5s before running this step's cursor
        // script. Gives them time to click Back again to keep
        // back-tracking without fighting BeakerBot's cursor. Any
        // further step transition during the wait cancels via the
        // existing `cancelled` flag set by the effect's cleanup.
        if (getLastTourTransition() === "goBack") {
          await new Promise<void>((resolve) => setTimeout(resolve, 5000));
          if (cancelled) return;
        }
        // Reset the marker so a subsequent in-place re-render of this
        // same step doesn't pause again.
        setLastTourTransition("advance");

        const liveRef = cursorRef.current;
        if (!liveRef) return;
        // §6.7 HE-8 off-screen entry: snap the cursor to the named
        // off-viewport edge BEFORE runScript fires. The first glide in
        // the action list then reads as "bringing something in from
        // outside the viewport."
        if (stepBody.cursorEntry && typeof window !== "undefined") {
          const margin = 80;
          switch (stepBody.cursorEntry) {
            case "offscreen-right":
              liveRef.snapTo(window.innerWidth + margin, window.innerHeight / 2);
              break;
            case "offscreen-left":
              liveRef.snapTo(-margin, window.innerHeight / 2);
              break;
            case "offscreen-top":
              liveRef.snapTo(window.innerWidth / 2, -margin);
              break;
            case "offscreen-bottom":
              liveRef.snapTo(window.innerWidth / 2, window.innerHeight + margin);
              break;
          }
        }
        // The input lock was already flipped ON at the top of this
        // effect (Wave 2 Fix 5/9) so the lock covers the script
        // build phase too. Nothing to flip here; runScript just plays
        // the already-locked queue.
        try {
          await liveRef.runScript(actions, abortController.signal);
        } finally {
          // Watchdog cleared regardless of outcome — a normally-
          // resolving runScript shouldn't fire the watchdog late.
          clearWatchdog();
          // If the watchdog already fired we already setCursorActive(false)
          // and cleared the window flag; don't bounce the state.
          if (!cancelled && !watchdogFired) {
            setCursorActive(false);
            // §6.1 nav fix (2026-05-25): clear the window flag the
            // auto-nav effect consults so a post-script pathname
            // change (e.g. the user clicks Got it, next and the next
            // step's expectedRoute push) is allowed through normally.
            if (typeof window !== "undefined") {
              (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
                .__beakerBotCursorScriptRunning = false;
            }
          }
        }
      } catch (err) {
        clearWatchdog();
        console.warn(
          `[TourController] cursor script for step "${currentStep}" failed:`,
          err,
        );
        if (!cancelled && !watchdogFired) {
          setCursorActive(false);
          // §6.1 nav fix (2026-05-25): clear the window flag on
          // error too so a subsequent step's expectedRoute push
          // is not suppressed.
          if (typeof window !== "undefined") {
            (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
              .__beakerBotCursorScriptRunning = false;
          }
        }
      }
    })();

    // §6.2 click-bypass R2 root-cause fix (2026-05-26): safety drain
    // for the pending-navigation flag. `safeNavClickAction` sets
    // `__beakerBotCursorPendingNavigation = true` before firing
    // `el.click()` so the auto-nav effect doesn't bounce the user
    // back to `expectedRoute` when the async `router.push` lands. The
    // auto-nav effect consumes the flag on the first pathname change
    // it observes. If the click never produced a pathname change
    // (defensive: a future bug where the receiver onClick handler
    // short-circuits, or the project ID is invalid), the flag would
    // stay sticky and let a SUBSEQUENT legitimate auto-nav push
    // (user navigates back to a different step) be incorrectly
    // suppressed. A 2s timeout drains the flag if it's still set —
    // long enough for any reasonable React commit + route change to
    // land, short enough that a stuck flag doesn't outlast the
    // user's confused click into the next step.
    const pendingNavDrainTimer =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            const w = window as unknown as {
              __beakerBotCursorPendingNavigation?: boolean;
            };
            if (w.__beakerBotCursorPendingNavigation) {
              w.__beakerBotCursorPendingNavigation = false;
            }
          }, 2000)
        : null;

    return () => {
      cancelled = true;
      // Wave 2 Fix 3/9: signal the in-flight runScript to abort at the
      // next action boundary + wake any abortable sleep / pause that's
      // currently parked. Without this the cursor queue would keep
      // chugging through the prior step's actions until it naturally
      // ran out, which was visible to users when fast-clicking through
      // steps.
      abortController.abort();
      // Clear the watchdog so a step that exits cleanly (user clicked
      // Got-it / Skip / Back) doesn't fire the watchdog late from a
      // dangling timer.
      clearWatchdog();
      // §6.2 click-bypass R2 root-cause fix: also clear the pending-
      // nav drain timer so a step transition doesn't leave a dangling
      // timer that flips the flag on the next step.
      if (pendingNavDrainTimer !== null) {
        clearTimeout(pendingNavDrainTimer);
      }
      // Release the lock the moment the step exits — even if runScript
      // is still mid-animation, we want the user free to interact with
      // the next step's surface. Skip / Back paths from the speech
      // bubble (which stays clickable through the overlay) trigger this
      // cleanup as the step changes.
      setCursorActive(false);
      // §6.1 nav fix (2026-05-25): clear the window flag on cleanup so
      // a step transition (advance / skip / back) doesn't leave the
      // flag stuck true and suppress legitimate auto-nav pushes on
      // the next step's expectedRoute.
      if (typeof window !== "undefined") {
        (window as unknown as { __beakerBotCursorScriptRunning?: boolean })
          .__beakerBotCursorScriptRunning = false;
        // Also drain pending-nav on step exit — if the cursor's click
        // initiated a nav and the user advances/skips before the
        // pathname has changed, we don't want the flag carrying into
        // the next step.
        (window as unknown as { __beakerBotCursorPendingNavigation?: boolean })
          .__beakerBotCursorPendingNavigation = false;
      }
    };
  }, [currentStep]);

  // §6.2 NAV escape hatch manager 2026-05-23 — ESC force-exit.
  // ESC listener regression fix (2026-05-26 explorer break-bot):
  // pressing Escape now opens a confirm dialog instead of
  // immediately routing to `onExitTour`. The prior behavior silently
  // fast-forwarded the user past every remaining beat straight to
  // `tour-goodbye` — indistinguishable from a buggy skip — because
  // both ESC and the in-bubble "Skip walkthrough" link map to the
  // same `exitTour()` call (which jumps to the terminal goodbye
  // step). The confirm mirrors the modal-setup phase's
  // `SetupSkipConfirmModal` pattern so the user has a one-click
  // safety net for an accidental Escape (mid-edit, while clearing a
  // popup, etc.) and a one-click confirm when they really do want
  // out. A second ESC press while the confirm is open dismisses
  // the confirm (handled by the early-return branch below) so the
  // keyboard path stays recoverable end-to-end.
  //
  // Scope: only fires while the walkthrough overlay component is
  // mounted (this component IS only mounted in walkthrough mode
  // per the controller's render branch), so ESC outside a tour
  // (closing a modal, blurring an input, etc.) continues to
  // behave normally. We also skip the binding entirely when the
  // event target is inside a contenteditable, textarea, or
  // editable input AND the cursor lock is not active — that keeps
  // editor ESC affordances (commit a code-mirror multi-cursor,
  // exit a hybrid editor block) intact during user-action steps.
  // When the cursor lock IS active, the user is wedged and ESC
  // should still surface the confirm regardless of focus.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Modifier-combo ESC is power-user / app-shortcut territory;
      // pass through.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // esc-skip-confirm misfire manager (2026-05-27): walkthrough
      // step bodies dispatch programmatic Escape keydowns to drive
      // host surfaces (GanttExistingExperimentStep closes the popup,
      // hybrid-editor-helpers.commitOpenEditAction exits the open
      // edit block). Both dispatch with `bubbles: true` so the host
      // surface's window-level keydown listener fires — but that
      // also reaches this listener and used to trip the skip-confirm
      // modal mid-tour. Tagged events carry an `isTourSyntheticEscape`
      // marker so we can route around our own dispatches without
      // changing the host listener contracts.
      if (isTourSyntheticEscape(e)) return;
      // Already showing the confirm — second ESC dismisses the
      // confirm dialog (recoverable keyboard path) instead of
      // bubbling to the browser. preventDefault + stopPropagation
      // below cover the rest of the cancel semantics.
      if (showEscSkipConfirm) {
        e.preventDefault();
        e.stopPropagation();
        setShowEscSkipConfirm(false);
        return;
      }
      const target = e.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "TEXTAREA" ||
          (target.tagName === "INPUT" &&
            !(target as HTMLInputElement).readOnly));
      // If the cursor lock is NOT active and the user is typing in
      // an editor, let ESC do its native thing (blur / commit /
      // close-popover). Once the lock IS up the user is wedged
      // and we always surface the confirm.
      if (!cursorActive && isEditableTarget) return;
      console.info(
        "[TourController] ESC pressed during walkthrough — opening Skip walkthrough confirm",
      );
      e.preventDefault();
      e.stopPropagation();
      setShowEscSkipConfirm(true);
    };
    // Capture phase so a focused button / modal can't swallow the
    // key before we route it to the confirm.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [cursorActive, showEscSkipConfirm]);

  const showSpotlight = !!body?.targetSelector;

  // Read the page-lock state for the user-action steps (Gantt redesign
  // 2026-05-22). The lock + the flash speech are both surfaced via the
  // controller context so step bodies can mount/unmount them from their
  // onEnter/onExit slots.
  const controller = useTourController();
  const pageLockTargets = controller.pageLockTargets;
  const pageLockFlash = controller.pageLockWrongClickFlash;

  return (
    <>
      {showSpotlight && body?.targetSelector && (
        <TourSpotlight target={body.targetSelector} />
      )}
      <BeakerBotCursor
        ref={cursorRef}
        heldImage={body?.cursorHeldImage}
      />
      {/* Input lock overlay (Bug B, sub-bot 2026-05-21). Renders only
          while the cursor is actively running a script; absent otherwise
          so user-action steps + idle gaps don't lock the page. */}
      <InputLockOverlay active={cursorActive} />
      {/* TourPageLock — two opt-in paths. Either:
          (a) Gantt redesign 2026-05-22: user-action steps call
              `controller.setPageLock(targets, oopsCopy)` so the controller
              owns the lifecycle; the lock renders here when `pageLockTargets`
              is non-null.
          (b) Hybrid editor 2026-05-22: a step's body declares
              `pageLock: { allowList, pillLabel }` for sustained read-
              then-watch locks held for the whole step. The current
              TourPageLock primitive uses the Gantt API
              (`allowedTargets: string[]`); the body.pageLock path is
              accepted here for forward compat and translates the
              allow-list selectors to the controller API. Master
              follow-up: harmonize the two contracts into one. */}
      <TourPageLock
        allowedTargets={pageLockTargets}
        pillLabel={controller.pageLockPillLabel}
      />

      <TourBeakerBotOverlay
        step={body}
        onManualAdvance={onManualAdvance}
        onSkipStep={onSkipStep}
        onExitTour={onExitTour}
        onBack={onBack}
        onBranchTo={onBranchTo}
        canGoBack={canGoBack}
        cursorActive={cursorActive}
        flashSpeech={
          pageLockFlash ??
          (controller.targetDetachRecoveryLabel ? (
            <span data-testid="tour-target-detach-recovery">
              Looks like that closed. Click {controller.targetDetachRecoveryLabel} to re-open and try again.
            </span>
          ) : null)
        }
      />
      {/* ESC listener regression fix (2026-05-26 explorer break-bot).
          Confirm modal surfaced when the user hits Escape mid-tour.
          Cancel returns to the tour at the current step (no state
          change); Confirm routes through `onExitTour` exactly the way
          the in-bubble "Skip walkthrough" link does, so we don't fork
          the exit path. Reuses `SetupSkipConfirmModal` so the copy
          (Skip to cleanup selector / Yes, skip ahead) matches the
          modal-setup phase's wizard pattern. */}
      {showEscSkipConfirm && (
        <SetupSkipConfirmModal
          onCancel={() => setShowEscSkipConfirm(false)}
          onConfirm={() => {
            setShowEscSkipConfirm(false);
            onExitTour();
          }}
          // ESC during the in-product walkthrough always sits AFTER
          // setup completion (the modal-setup phase owns its own skip
          // link). Real content has been built by this point; the
          // cleanup-selector copy applies. (Copy-alignment manager
          // 2026-05-26.)
          isWelcomeStep={false}
        />
      )}
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
  // Wave 2 Fix 8/9: focus trap. Tab at the last focusable wraps to
  // the first; Shift+Tab at the first wraps to the last. Applies
  // only while the modal-setup shell is mounted (the walkthrough
  // phase uses TourPageLock / InputLockOverlay, not a focus trap).
  const modalRef = useRef<HTMLDivElement | null>(null);

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

  // Wave 2 Fix 8/9: focus-trap effect. Listens for Tab/Shift+Tab on
  // the modal subtree and wraps focus when it would otherwise leave
  // the modal. The modal also covers the rest of the page visually
  // (backdrop overlay) so without this, Tab would let keyboard
  // focus wander into the background page even though it's
  // pointer-blocked.
  useEffect(() => {
    if (!mounted) return;
    if (typeof document === "undefined") return;
    const FOCUSABLE_SELECTOR = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mounted, stepId]);

  if (!mounted) return null;

  const { Component, title, pose, hideFooter } = descriptor;
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
      ref={modalRef}
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
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Setup
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-gray-400">
                    {stepId}
                  </span>
                  {/* Copy-alignment manager 2026-05-26: header X mirrors
                      the bottom "Skip walkthrough" link so the skeptic
                      who looks for a close affordance up top finds one.
                      Same confirm modal as the bottom link, so escape
                      paths converge. Inline SVG (no lucide-react), wrapped
                      in Tooltip per the icon-only button rule. */}
                  <Tooltip label="Skip walkthrough" placement="bottom">
                    <button
                      type="button"
                      onClick={() => setShowSkipConfirm(true)}
                      aria-label="Skip walkthrough"
                      className="text-gray-400 hover:text-gray-600 transition-colors rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </Tooltip>
                </div>
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

        {/* v4 setup wrap-up step manager 2026-05-24: the setup-wrapup
            beat sets `hideFooter: true` on its descriptor so the body
            can render its own CTAs (Go to home / Take the feature
            tour). The shell's Back / Skip / Next / Skip-walkthrough
            footer is hidden for that step only. Padding is preserved
            so the modal rounded-bottom doesn't sit flush against the
            body. */}
        {hideFooter ? (
          <div className="pb-4" />
        ) : (
          <>
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
          </>
        )}
      </div>

      {showSkipConfirm && (
        <SetupSkipConfirmModal
          onCancel={() => setShowSkipConfirm(false)}
          onConfirm={handleGotItConfirm}
          isWelcomeStep={isWelcome}
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
 *
 * Copy-alignment manager 2026-05-26: the confirm dialog used to read
 * "You can review everything we made and keep or discard each item." at
 * every setup step, including welcome (step 0) where nothing has been
 * made yet. The `isWelcomeStep` branch swaps in copy that doesn't
 * promise content the user hasn't built.
 */
function SetupSkipConfirmModal({
  onCancel,
  onConfirm,
  isWelcomeStep,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  isWelcomeStep: boolean;
}) {
  const heading = isWelcomeStep
    ? "Skip the walkthrough?"
    : "Skip to the cleanup selector?";
  const body = isWelcomeStep
    ? "You can run the walkthrough later from Settings if you change your mind."
    : "You can review everything we made and keep or discard each item.";
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isWelcomeStep ? "Skip walkthrough" : "Skip to cleanup selector"
      }
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[420px] max-w-[calc(100vw-2rem)] mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900">{heading}</h3>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">{body}</p>
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

// ---------------------------------------------------------------------------
// Bubble-flip helpers (overnight bubble-flip sub-bot, 2026-05-26)
//
// Problem: the BeakerBot overlay (mascot + speech bubble) lives anchored
// bottom-right. When a step's interaction target ALSO lands in the
// bottom-right viewport quadrant (e.g. the Add-widget catalog popup, or
// a cursor demo poking a button down there), the bubble visually covers
// what BeakerBot is supposed to be demonstrating. Grant's directive:
// "what beaker is doing is being hidden! He and the text needs to move
// to the other side of the screen if where he is interacting with is
// covered".
//
// Fix: compute the bubble's would-be rect (or a coarse bottom-right /
// bottom-left "danger zone" rect) and intersect it against the active
// interaction target. If they overlap, anchor the overlay to bottom-LEFT
// instead so the right side is unobstructed. The bubble's internal layout
// (back link left / CTA center / skips right) is unchanged — only the
// overlay's outer anchor flips. CSS `transition: left 200ms / right 200ms`
// keeps the flip smooth so it doesn't snap mid-step.
//
// Two-sided occlusion (target spans width): the helper picks whichever
// side has more empty horizontal clearance from the target. Tie goes to
// the default (right).
// ---------------------------------------------------------------------------

/** Bubble overlay anchor side. "right" is the default; "left" is the
 *  flipped state used when the right-anchored bubble would occlude the
 *  active interaction target. */
export type BubbleAnchorSide = "left" | "right";

/** Minimal rect shape used by the flip helper. Mirrors DOMRect for
 *  testability (the helper is pure; tests pass plain objects in). */
interface FlipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Width (px) of the bubble's "danger zone" used when computing whether
 *  the right-anchored bubble overlaps the interaction target. The real
 *  rendered bubble caps at maxWidth 380 and the mascot at 120; we use
 *  the bubble's max so the danger zone covers the wider of the two
 *  vertically-stacked elements. */
const BUBBLE_DANGER_WIDTH = 380;

/** Height (px) of the danger zone — bubble (~180px max) + 8px gap +
 *  mascot (120px). Slightly generous so a tall multi-line speech bubble
 *  doesn't escape the predicate. */
const BUBBLE_DANGER_HEIGHT = 320;

/** Right inset (px) from the viewport edge to the bubble's right edge
 *  when anchored right. Matches `right-6` (Tailwind 1.5rem = 24px). */
const BUBBLE_EDGE_INSET = 24;

/** Bottom inset (px) from the viewport edge to the bubble's bottom edge.
 *  Matches the explicit `bottom: 96` style on the overlay (24 + 48 FAB +
 *  24 gap, see the comment block on the overlay's render). */
const BUBBLE_BOTTOM_INSET = 96;

/** Compute the bubble's danger-zone rect for a given anchor side and
 *  viewport size. Pure — no DOM access — so the helper is callable from
 *  tests without jsdom rect mocks. */
export function getBubbleDangerRect(
  side: BubbleAnchorSide,
  viewportWidth: number,
  viewportHeight: number,
): FlipRect {
  // The danger zone is BUBBLE_DANGER_HEIGHT tall, growing UP from
  // (viewportHeight - BUBBLE_BOTTOM_INSET).
  const bottomEdge = viewportHeight - BUBBLE_BOTTOM_INSET;
  const topEdge = bottomEdge - BUBBLE_DANGER_HEIGHT;
  if (side === "right") {
    const rightEdge = viewportWidth - BUBBLE_EDGE_INSET;
    const leftEdge = rightEdge - BUBBLE_DANGER_WIDTH;
    return { left: leftEdge, top: topEdge, right: rightEdge, bottom: bottomEdge };
  }
  // side === "left"
  const leftEdge = BUBBLE_EDGE_INSET;
  const rightEdge = leftEdge + BUBBLE_DANGER_WIDTH;
  return { left: leftEdge, top: topEdge, right: rightEdge, bottom: bottomEdge };
}

/** Returns true when two rects overlap. Pure. */
export function rectsOverlap(a: FlipRect, b: FlipRect): boolean {
  if (!a || !b) return false;
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}

/** Pure helper: given the active interaction target rect(s) plus
 *  viewport size, return the anchor side that minimizes occlusion.
 *
 *  - No targets: default to "right" (the resting state).
 *  - Right-anchored bubble doesn't overlap any target: stay "right".
 *  - Right-anchored bubble overlaps but left-anchored doesn't: flip to "left".
 *  - Both sides overlap: pick whichever has more horizontal clearance
 *    from the closest target (i.e. the side with the larger gap between
 *    the bubble's inner edge and the target's nearest edge). Tie → "right".
 */
export function computeBubbleAnchorSide(
  targets: ReadonlyArray<FlipRect | null | undefined>,
  viewportWidth: number,
  viewportHeight: number,
): BubbleAnchorSide {
  const valid = targets.filter(
    (r): r is FlipRect =>
      !!r &&
      Number.isFinite(r.left) &&
      Number.isFinite(r.right) &&
      Number.isFinite(r.top) &&
      Number.isFinite(r.bottom) &&
      r.right > r.left &&
      r.bottom > r.top,
  );
  if (valid.length === 0) return "right";

  const rightZone = getBubbleDangerRect("right", viewportWidth, viewportHeight);
  const leftZone = getBubbleDangerRect("left", viewportWidth, viewportHeight);

  const rightOverlap = valid.some((t) => rectsOverlap(rightZone, t));
  const leftOverlap = valid.some((t) => rectsOverlap(leftZone, t));

  if (!rightOverlap) return "right";
  if (!leftOverlap) return "left";

  // Two-sided occlusion: pick the side with more clearance. Clearance
  // is the gap between the bubble's INNER edge (left edge of the right
  // zone, right edge of the left zone) and the nearest target edge on
  // that side. Larger gap = more breathing room.
  let rightClearance = -Infinity;
  let leftClearance = -Infinity;
  for (const t of valid) {
    // Right-anchored clearance: how far left of the right zone the
    // target's right edge sits.
    rightClearance = Math.max(rightClearance, rightZone.left - t.right);
    // Left-anchored clearance: how far right of the left zone the
    // target's left edge sits.
    leftClearance = Math.max(leftClearance, t.left - leftZone.right);
  }
  return leftClearance > rightClearance ? "left" : "right";
}

/** Find the nearest popup-like ancestor of `el`. A "popup" is something
 *  the user perceives as a transient surface: role="dialog" / "menu" /
 *  "listbox" / "tooltip", an element with `data-tour-popup="true"`, OR
 *  (heuristic) an element whose `data-tour-target` value contains one
 *  of the words "catalog", "modal", "popup", "menu", "dropdown",
 *  "popover". Returns null if no popup ancestor exists. */
function findPopupAncestor(el: HTMLElement | null): HTMLElement | null {
  let cursor: HTMLElement | null = el;
  while (cursor && cursor !== document.body) {
    const role = cursor.getAttribute("role");
    if (
      role === "dialog" ||
      role === "menu" ||
      role === "listbox" ||
      role === "tooltip"
    ) {
      return cursor;
    }
    if (cursor.dataset.tourPopup === "true") return cursor;
    const tt = cursor.getAttribute("data-tour-target");
    if (
      tt &&
      /catalog|modal|popup|menu|dropdown|popover/i.test(tt)
    ) {
      return cursor;
    }
    cursor = cursor.parentElement;
  }
  return null;
}

/** Read the rect of a DOM element, or null if the element is missing,
 *  detached, or has a zero-area bounding box. */
function safeRect(el: Element | null): FlipRect | null {
  if (!el) return null;
  if (el instanceof HTMLElement && !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Hook: compute the current bubble anchor side based on the active
 *  step's spotlight target, the BeakerBot cursor element (when the
 *  cursor is mid-script), and the nearest popup ancestor of the
 *  spotlight target. Updates on step change, on cursor active/inactive,
 *  and on viewport resize / scroll (rAF-batched).
 *
 *  Per the design brief: we DON'T re-evaluate on every render — only on
 *  step entry, viewport resize, scroll, or cursor-active flip. That way
 *  a transient mid-step rect bounce (e.g. a popup opening then closing
 *  again 50ms later as part of the same demo) doesn't pingpong the
 *  bubble side mid-step. */
function useBubbleAnchorSide(
  targetSelector: string | undefined,
  cursorActive: boolean,
  stepId: TourStepId | null,
  forceSide?: BubbleAnchorSide,
): BubbleAnchorSide {
  const [side, setSide] = useState<BubbleAnchorSide>("right");

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    // forceSide overrides the auto-flip predicate. Used by steps whose
    // visual context has a fixed-position sidebar (e.g., the hybrid
    // markdown editor's Shortcuts panel) that the auto-flip math doesn't
    // know to avoid. When set, skip all the rect-collecting and just
    // commit the forced side.
    if (forceSide) {
      setSide((prev) => (prev === forceSide ? prev : forceSide));
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;

    const compute = () => {
      rafId = null;
      if (cancelled) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const targets: Array<FlipRect | null> = [];

      // Spotlight target rect.
      let spotlightEl: HTMLElement | null = null;
      if (targetSelector) {
        try {
          const found = document.querySelector(targetSelector);
          if (found instanceof HTMLElement) spotlightEl = found;
        } catch {
          // Invalid selector — ignore.
        }
      }
      targets.push(safeRect(spotlightEl));

      // Cursor wrapper rect (only when the cursor is actively driving a
      // script). The cursor wrapper carries `data-beakerbot-cursor`.
      if (cursorActive) {
        const cursorEl = document.querySelector("[data-beakerbot-cursor]");
        targets.push(safeRect(cursorEl));
      }

      // Popup-ancestor rect: if the spotlight target lives inside a
      // popup/dialog/menu, include the popup's bounding rect so a
      // popup that extends well beyond the target still triggers the
      // flip. The home-widget-catalog case is exactly this — the
      // spotlight points at the +Add button (bottom-right of canvas),
      // but the catalog popup that opens covers a much larger area.
      if (spotlightEl) {
        const popup = findPopupAncestor(spotlightEl);
        if (popup) targets.push(safeRect(popup));
      }
      // Also include any free-standing popup surfaces present in the
      // DOM (role="dialog" elements that are visible but unrelated to
      // the spotlight target). Keeps the predicate honest if a step's
      // demo opens a modal but the spotlight points at the trigger
      // button outside it.
      const dialogs = document.querySelectorAll(
        '[role="dialog"], [role="menu"], [data-tour-popup="true"]',
      );
      dialogs.forEach((d) => targets.push(safeRect(d)));

      const next = computeBubbleAnchorSide(targets, vw, vh);
      setSide((prev) => (prev === next ? prev : next));
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(compute);
    };

    // Initial compute (rAF-scheduled so any mid-step DOM transition has
    // a frame to settle before we read rects).
    schedule();

    // Re-evaluate on viewport resize + on scroll (capture so nested
    // scroll containers bubble through). Passive — we never
    // preventDefault.
    const onResize = () => schedule();
    const onScroll = () => schedule();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });

    // Re-evaluate on DOM mutations under document.body so a popup
    // mounting / unmounting mid-step gets picked up without polling.
    // This is the path that fires the catalog flip — at step entry the
    // catalog isn't mounted yet, so the initial compute sees only the
    // +Add button (small, doesn't trigger flip), then the cursor
    // demo opens the catalog and the MutationObserver schedules a
    // re-compute that detects the popup and flips.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, { capture: true });
      mo.disconnect();
    };
    // Re-run on step change (stepId), targetSelector change, or
    // cursor-active flip. Each is a legitimate "interaction surface
    // changed" boundary that warrants a fresh measurement.
  }, [targetSelector, cursorActive, stepId]);

  return side;
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
 *
 * Bubble-flip (2026-05-26): when the active interaction target (the
 * spotlight target, the cursor mid-demo, or an open popup ancestor)
 * intersects the bubble's bottom-right danger zone, the overlay
 * anchors to bottom-LEFT instead. CSS transitions keep the flip
 * smooth.
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
  /** §6.7 HE-2 branch-completion handler. Wired through from the
   *  controller's `branchTo` action; the bubble dispatches it on each
   *  branch button click. */
  onBranchTo: (nextStep: TourStepId) => void;
  canGoBack: boolean;
  /** Page-lock wrong-click flash speech (Gantt redesign 2026-05-22).
   *  When non-null, replaces the step's normal speech for the 2-second
   *  flash window. Cleared by the controller after the timeout. */
  flashSpeech?: ReactNode | null;
  /** Bubble-flip (2026-05-26): mirror of the parent overlay's
   *  cursorActive state. When true, the BeakerBotCursor wrapper rect
   *  is included as an interaction target for the flip predicate so
   *  the bubble dodges the cursor's current zone too, not just the
   *  spotlight / popup. */
  cursorActive?: boolean;
}

function TourBeakerBotOverlay({
  step,
  onManualAdvance,
  onSkipStep,
  onExitTour,
  onBack,
  onBranchTo,
  canGoBack,
  flashSpeech,
  cursorActive = false,
}: TourBeakerBotOverlayProps) {
  // R2 regression followup Fix 1/3 + Fix 3/3 (2026-05-23):
  //  - Fix 1: `disabledUntilEvent` gating: if the active step's
  //    `manual` completion declares a `disabledUntilEvent`, the
  //    "Got it, next" button renders disabled until that
  //    window-level CustomEvent fires. Closes the literal-reader
  //    catch on §6.8 `gantt-share-profile-switch` where the prior
  //    `advanceOnEvent` auto-advanced silently (no user button) and
  //    broke Grant's "user-gated on note-write" spec.
  //  - Fix 3: post-click debounce. The manual-advance button locks
  //    itself after the first click so a rapid double-click can't
  //    advance two steps in the narrow window between React
  //    rendering the new step and the second click event landing.
  //    The setup-modal Next button already has its own debounce; the
  //    walkthrough overlay button didn't. Distracted-persona catch.
  //
  // Both states are keyed off `step?.id` so they reset per step
  // (the same useEffect clears them on step change).
  const stepId = step?.id ?? null;
  const manualDisabledUntilEvent =
    step?.completion.type === "manual"
      ? step.completion.disabledUntilEvent
      : undefined;
  const manualDisabledAriaLabel =
    step?.completion.type === "manual"
      ? step.completion.disabledAriaLabel
      : undefined;
  const [eventFired, setEventFired] = useState(false);
  const [advanceClicked, setAdvanceClicked] = useState(false);

  // Subscribe to the gate event for the active step. Listener is
  // window-scoped + once-only; cleared on step change so each new
  // step starts ungated. Also resets the advanceClicked debounce so
  // the per-step lock unwinds the moment the controller moves us to
  // the next step.
  useEffect(() => {
    setEventFired(false);
    setAdvanceClicked(false);
    if (!manualDisabledUntilEvent || typeof window === "undefined") {
      return;
    }
    const handler = (): void => setEventFired(true);
    window.addEventListener(manualDisabledUntilEvent, handler, {
      once: true,
    });
    return () => {
      window.removeEventListener(manualDisabledUntilEvent, handler);
    };
  }, [stepId, manualDisabledUntilEvent]);

  // Fix 4: gate Got-it-next while BeakerBot's cursor script is still
  // running (Grant feedback 2026-05-26: tour wedged on §6.5
  // workbench-create-experiment → §6.6 attachment-open because the
  // user clicked Got-it-next while the cursor was mid-submit. The
  // create-experiment click hadn't fired yet, so the modal stayed
  // open, then §6.6's cursor tried to click a workbench row that was
  // still covered by the modal). Disable the button while the cursor
  // is active, PLUS a small settle buffer after it deactivates so
  // modal-close / route-change transitions can finish before the
  // next step's cursor fires.
  //
  // Buffer rationale: the cursor flips `cursorActive` false the
  // moment its script returns, but the script's terminal click
  // (submit, navigate, close) usually triggers async state — modal
  // exit animations, router transitions — that take ~300-500ms to
  // settle. 600ms is generous enough to cover the common cases
  // without feeling laggy to the user.
  const CURSOR_SETTLE_BUFFER_MS = 600;
  const [cursorSettling, setCursorSettling] = useState(false);
  useEffect(() => {
    if (cursorActive) {
      // While the script is running, no settling needed (the cursor
      // gate alone disables the button).
      setCursorSettling(false);
      return;
    }
    if (!step?.cursorScript) {
      // Step has no cursor demo — never gate.
      setCursorSettling(false);
      return;
    }
    // Cursor just deactivated for a step that HAD a script. Hold the
    // disabled state through the settle buffer so any modal-close /
    // route change kicked off by the script's terminal action lands
    // before the user can advance.
    setCursorSettling(true);
    const t = setTimeout(() => setCursorSettling(false), CURSOR_SETTLE_BUFFER_MS);
    return () => clearTimeout(t);
    // Re-run when the step changes or cursorActive flips. step?.cursorScript
    // is a stable function ref per step body, safe to depend on.
  }, [cursorActive, stepId, step?.cursorScript]);
  const cursorDemoBusy = cursorActive || cursorSettling;

  // Bubble-flip (2026-05-26 bubble-flip sub-bot): compute the anchor
  // side BEFORE the early-return so the hook call order stays stable
  // when `step` flips between undefined and a real step. The hook
  // tolerates undefined targetSelector / null stepId (treats them as
  // "no interaction target" → defaults to right anchor). See
  // `useBubbleAnchorSide` for the full predicate.
  const anchorSide = useBubbleAnchorSide(
    step?.targetSelector,
    cursorActive,
    stepId,
    step?.forceBubbleSide,
  );

  if (!step) return null;

  const speechNode = flashSpeech
    ? flashSpeech
    : typeof step.speech === "function"
    ? step.speech()
    : step.speech;

  const manualButtonLabel =
    step.completion.type === "manual"
      ? step.completion.buttonLabel ?? "Got it, next"
      : null;
  // Button is disabled if any of:
  //  (a) the step declares `disabledUntilEvent` and the event hasn't
  //      fired yet for this step entry (Fix 1), OR
  //  (b) the user has already clicked once this step entry (Fix 3
  //      double-click debounce), OR
  //  (c) BeakerBot's cursor script is still running OR within the
  //      post-script settle buffer (Fix 4, 2026-05-26 wedge fix).
  const manualGateActive = !!manualDisabledUntilEvent && !eventFired;
  const manualButtonDisabled =
    manualGateActive || advanceClicked || cursorDemoBusy;
  const manualButtonAriaLabel =
    manualGateActive && manualDisabledAriaLabel
      ? manualDisabledAriaLabel
      : cursorDemoBusy
      ? "BeakerBot is still demonstrating, hold on"
      : manualButtonLabel ?? "";

  // §6.7 HE-2: branch buttons render in place of the "Got it, next"
  // affordance when the step declares branch-completion. The user picks
  // a branch by clicking; the controller jumps to that branch's
  // `nextStep` via `onBranchTo`.
  const branches =
    step.completion.type === "branch" ? step.completion.branches : null;
  // Lab Mode fix manager R1 (2026-05-22): optional `onChoose` hook so
  // `lab-mode-prompt` can persist the chosen branch to the sidecar
  // BEFORE the controller advances. Runs sequentially before
  // `onBranchTo` so the persisted state matches the step the user
  // ends up on. Errors are caught + logged but never block the
  // advance — a wedged tour is worse than a missed sidecar write
  // (the resume-guard re-prompts on next launch anyway).
  const branchOnChoose =
    step.completion.type === "branch"
      ? step.completion.onChoose
      : undefined;

  // Anchor position: bottom-right by default, but clear of AppShell's
  // FAB cluster. AppShell mounts a horizontal row of ~7 round 48px
  // buttons at `fixed bottom-6 right-6` (see AppShell.tsx ~line 306).
  // With the 24px bottom inset + 48px button height, that cluster
  // occupies the bottom 72px of the right edge. We anchor BeakerBot
  // 24px above the cluster's top (bottom: 96px) so the mascot + speech
  // bubble sit clearly above the row instead of overlapping the
  // donation / bug-report buttons. The right-6 (24px) inset matches
  // the cluster so the two elements visually align on the right edge.
  //
  // Bubble-flip (2026-05-26): when the active interaction target
  // overlaps the right-anchored bubble, anchor bottom-LEFT instead.
  // `useBubbleAnchorSide` (called above the early-return) does the
  // computation; here we just consume its `anchorSide` to switch
  // layout class + inline left/right with a transition for smooth
  // animation.
  return (
    <div
      data-testid="tour-beakerbot-overlay"
      data-bubble-anchor-side={anchorSide}
      className={
        anchorSide === "left"
          ? "fixed z-[450] pointer-events-none flex flex-col items-start gap-2"
          : "fixed z-[450] pointer-events-none flex flex-col items-end gap-2"
      }
      style={{
        maxWidth: 380,
        bottom: 96,
        // Drive horizontal position via inline left/right + a
        // transition so the flip animates. The "off" side sits at
        // `auto` so the layout system uses the other axis exclusively
        // (left+right both set would force-stretch via flex, which we
        // don't want for a fixed-size pop).
        left: anchorSide === "left" ? 24 : undefined,
        right: anchorSide === "right" ? 24 : undefined,
        transition: "left 200ms ease-out, right 200ms ease-out",
      }}
    >
      {/* Speech bubble. Above-and-to-the-left of the BeakerBot per L4.
          Pointer events are re-enabled here so the user can click
          Skip / Exit / Got it — the wrapper above is non-interactive so
          it doesn't block clicks anywhere else on the page-body. */}
      {/* Surface tuning (Grant feedback 2026-05-26): the bubble previously
          used `bg-white` + `border-gray-200` and read as "transparent"
          against the widget canvas — the low-contrast edge let the
          background show conceptually even though the fill was opaque.
          Grant likes a *subtle* transparency effect, so we keep one
          explicit + controlled (95% white + backdrop blur) and define
          the edge more firmly (gray-300 border + shadow-2xl) so the
          bubble sits clearly above the canvas. The blur also helps
          readability when the bubble overlaps widget chrome. */}
      <div
        data-testid="tour-beakerbot-bubble"
        className="pointer-events-auto bg-white/95 backdrop-blur-md border border-gray-300 rounded-2xl shadow-2xl p-4 text-sm text-gray-800"
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
          {branches ? (
            <div
              data-testid="tour-beakerbot-branch-buttons"
              className="flex flex-wrap items-center justify-center gap-2"
            >
              {branches.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={async () => {
                    if (branchOnChoose) {
                      try {
                        await branchOnChoose({
                          label: b.label,
                          buttonLabel: b.buttonLabel,
                          nextStep: b.nextStep,
                        });
                      } catch (err) {
                        console.error(
                          `[TourController] branchOn.onChoose for step "${step.id}" threw:`,
                          err,
                        );
                      }
                    }
                    onBranchTo(b.nextStep);
                  }}
                  data-branch-label={b.label}
                  className="text-xs font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-full px-3 py-1.5"
                  aria-label={b.buttonLabel}
                >
                  {b.buttonLabel}
                </button>
              ))}
            </div>
          ) : manualButtonLabel ? (
            <button
              type="button"
              onClick={() => {
                if (manualButtonDisabled) return;
                setAdvanceClicked(true);
                onManualAdvance();
              }}
              disabled={manualButtonDisabled}
              data-testid="tour-manual-advance-button"
              data-disabled-until-event={manualGateActive ? "true" : undefined}
              data-debounce-locked={advanceClicked ? "true" : undefined}
              className={
                manualButtonDisabled
                  ? "text-xs font-medium bg-sky-500 text-white rounded-full px-3 py-1.5 opacity-50 cursor-not-allowed"
                  : "text-xs font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-full px-3 py-1.5"
              }
              aria-label={manualButtonAriaLabel}
              aria-disabled={manualButtonDisabled || undefined}
            >
              {manualButtonLabel}
            </button>
          ) : (
            <span />
          )}
          {step?.id === "tour-goodbye" ? (
            // Terminal "goodbye" step (Grant 2026-05-23 inline edit):
            // suppress Skip this step + Skip walkthrough entirely. Both
            // affordances are meaningless on the wrap-up screen (there
            // is no "next step" to skip to, and the walkthrough is
            // already over the moment Let's go is clicked). Empty
            // placeholder keeps the flex layout's right slot reserved
            // so the manual-advance button stays centered.
            <div aria-hidden className="w-[1px]" />
          ) : (
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
          )}
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
