/**
 * Shared step-builder helpers for the Onboarding v4 universal
 * walkthrough (P5). Each §6.x file imports these to construct its
 * `TourStep` entries with consistent defaults + minimal boilerplate.
 */
import type {
  TourStep,
  TourStepId,
  TourStepCompletion,
  BeakerBotPose,
  CursorAction,
} from "@/components/onboarding/v4/step-types";

/**
 * Common defaults applied to every walkthrough step: pose `pointing`,
 * non-conditional, etc. Individual steps override what they need.
 */
export interface StepBuilderInput {
  id: TourStepId;
  speech: TourStep["speech"];
  pose?: BeakerBotPose;
  targetSelector?: string;
  cursorScript?: () => CursorAction[] | Promise<CursorAction[]>;
  completion: TourStepCompletion;
  onEnter?: TourStep["onEnter"];
  onExit?: () => void | Promise<void>;
  conditionalOn?: TourStep["conditionalOn"];
  expectedRoute?: string;
  /** Optional larger surface to scroll into view before the cursor
   *  script runs. See `TourStep.viewportAnchor` for behavior. */
  viewportAnchor?: string;
  /** Optional page-lock config. See `TourStep.pageLock`. */
  pageLock?: TourStep["pageLock"];
  /** Optional off-screen cursor entry edge. See `TourStep.cursorEntry`. */
  cursorEntry?: TourStep["cursorEntry"];
  /** Optional image preview that tracks the cursor for the step's
   *  lifetime. See `TourStep.cursorHeldImage`. */
  cursorHeldImage?: TourStep["cursorHeldImage"];
  /** R2 chip B Fix 2/3 — Wave 2 Fix 2 target-detach watcher recovery
   *  hint. See `TourStep.recoveryHint`. Pre-fix this was missing from
   *  the builder so step bodies that wanted to spec a buttonLabel for
   *  the popup-Esc recovery copy could not, and the watcher always
   *  fell back to the generic "the button you clicked before". */
  recoveryHint?: TourStep["recoveryHint"];
}

/**
 * Build a `TourStep` with the standard walkthrough defaults.
 *
 * Why this exists: every step body would otherwise repeat `pose:
 * "pointing"` and the same shape boilerplate. Centralizing the defaults
 * lets the per-step files focus on the speech + cursor script + target
 * (the parts that actually vary).
 */
export function buildWalkthroughStep(input: StepBuilderInput): TourStep {
  return {
    id: input.id,
    speech: input.speech,
    pose: input.pose ?? "pointing",
    targetSelector: input.targetSelector,
    cursorScript: input.cursorScript,
    completion: input.completion,
    onEnter: input.onEnter,
    onExit: input.onExit,
    conditionalOn: input.conditionalOn,
    expectedRoute: input.expectedRoute,
    viewportAnchor: input.viewportAnchor,
    pageLock: input.pageLock,
    cursorEntry: input.cursorEntry,
    cursorHeldImage: input.cursorHeldImage,
    recoveryHint: input.recoveryHint,
  };
}

/**
 * Sugar for the most common completion contract on a cursor-driven
 * demo: auto-advance after the cursor script completes plus a small
 * buffer so the user has a beat to absorb the result before the next
 * step kicks in.
 */
export function autoAdvanceAfter(ms: number): TourStepCompletion {
  return { type: "auto", autoAdvanceAfterMs: ms };
}

/**
 * Sugar for the "Got it, next" manual completion. Optional custom
 * label.
 *
 * R2 regression followup 2026-05-23: optional `disabledUntilEvent`
 * gates the button on a window-level CustomEvent. Until the event
 * fires (after step entry), the button renders disabled with a "hold
 * on" aria-label. Pattern used by §6.8 gantt-share-profile-switch so
 * the user cannot advance before the genuine `appendBeakerBotNote`
 * write + modal sequence completes.
 */
export function manualAdvance(
  buttonLabel?: string,
  opts?: { disabledUntilEvent?: string; disabledAriaLabel?: string },
): TourStepCompletion {
  return {
    type: "manual",
    buttonLabel,
    disabledUntilEvent: opts?.disabledUntilEvent,
    disabledAriaLabel: opts?.disabledAriaLabel,
  };
}

/**
 * Sugar for event-driven completion. Wraps an `eventListener` function
 * (typically a `watchProjectCreated` / `watchImageAttached` / etc.) so
 * the call site reads more declaratively at the step body.
 */
export function advanceOnEvent(
  eventListener: (advance: () => void) => () => void,
): TourStepCompletion {
  return { type: "event", eventListener };
}

/**
 * In-tour user-choice gate. The speech bubble renders one button per
 * branch; the controller jumps to the branch's `nextStep` on click,
 * overriding the step-machine's normal forward traversal.
 *
 * Used by §6.7 HE-2 (hybrid-markdown-familiarity) so users who already
 * know markdown can skip the overview step, and users who don't can
 * elect into a short explainer. No sidecar write — the choice is
 * scoped to the current run.
 */
export function branchOn(
  branches: ReadonlyArray<{
    label: string;
    buttonLabel: string;
    nextStep: import("@/components/onboarding/v4/step-types").TourStepId;
  }>,
  options?: {
    /** Lab Mode fix manager R1 (2026-05-22): persistence hook for
     *  steps that need to write the chosen branch to the sidecar
     *  (e.g. `lab-mode-prompt`). Fires synchronously on button click,
     *  awaited before the controller's `branchTo` dispatch. Default
     *  branchOn (HE-2) omits this — the choice stays in-tour-only. */
    onChoose?: (chosen: {
      label: string;
      buttonLabel: string;
      nextStep: import("@/components/onboarding/v4/step-types").TourStepId;
    }) => void | Promise<void>;
  },
): TourStepCompletion {
  return options?.onChoose
    ? { type: "branch", branches, onChoose: options.onChoose }
    : { type: "branch", branches };
}
