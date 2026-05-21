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
  onEnter?: () => void | Promise<void>;
  onExit?: () => void | Promise<void>;
  conditionalOn?: TourStep["conditionalOn"];
  expectedRoute?: string;
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
 */
export function manualAdvance(buttonLabel?: string): TourStepCompletion {
  return { type: "manual", buttonLabel };
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
