// Onboarding tutor — the showcase player (pure stepping reducer).
//
// Walks one surface choreography step by step. A driver calls tick(deltaMs) on a
// timer (requestAnimationFrame / setInterval in the live layer); when a step's
// dwell elapses the player advances. pause/resume and skip keep the run under the
// user's control (no soft-lock). The selectors expose what the view needs at any
// moment: which control the presenter cursor points at, the narration line, and
// whether the reveal (morph) has happened yet.
//
// Pure, unit-tested, no timers or DOM here. No emojis, no em-dashes, no
// mid-sentence colons.

import type { SurfaceChoreography, ChoreoStep } from "./showcase-choreography";

export type PlayerStatus = "playing" | "paused" | "done";

export interface PlayerState {
  choreography: SurfaceChoreography;
  stepIndex: number;
  /** Time accrued on the current step. */
  elapsedMs: number;
  status: PlayerStatus;
}

export function initPlayer(choreography: SurfaceChoreography): PlayerState {
  return { choreography, stepIndex: 0, elapsedMs: 0, status: "playing" };
}

export type PlayerAction =
  | { type: "tick"; deltaMs: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "skip" } // jump straight to done (skip the rest of THIS demo)
  | { type: "restart" };

export function playerReducer(
  state: PlayerState,
  action: PlayerAction,
): PlayerState {
  switch (action.type) {
    case "pause":
      return state.status === "playing" ? { ...state, status: "paused" } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "playing" } : state;
    case "skip":
      return { ...state, status: "done" };
    case "restart":
      return initPlayer(state.choreography);
    case "tick": {
      if (state.status !== "playing") return state;
      const steps = state.choreography.steps;
      let stepIndex = state.stepIndex;
      let elapsed = state.elapsedMs + Math.max(0, action.deltaMs);
      // Advance across as many steps as the elapsed time covers (handles a big
      // delta after a dropped frame without skipping the visual states in state).
      while (stepIndex < steps.length && elapsed >= steps[stepIndex].durationMs) {
        elapsed -= steps[stepIndex].durationMs;
        stepIndex += 1;
      }
      if (stepIndex >= steps.length) {
        return { ...state, stepIndex: steps.length, elapsedMs: 0, status: "done" };
      }
      return { ...state, stepIndex, elapsedMs: elapsed };
    }
    default:
      return state;
  }
}

/** The step on screen now, or null when done. */
export function currentStep(state: PlayerState): ChoreoStep | null {
  return state.choreography.steps[state.stepIndex] ?? null;
}

/** The control the presenter cursor should point at right now (the most recent
 *  cursor_move or click target up to and including the current step), or null
 *  before the cursor has appeared. */
export function cursorTarget(state: PlayerState): string | null {
  const upTo = Math.min(state.stepIndex, state.choreography.steps.length - 1);
  for (let i = upTo; i >= 0; i--) {
    const s = state.choreography.steps[i];
    if (s.kind === "cursor_move" || s.kind === "click") return s.target ?? null;
  }
  return null;
}

/** True once the click step has been passed, so the view can play the click ring. */
export function isClicking(state: PlayerState): boolean {
  const s = currentStep(state);
  return s?.kind === "click";
}

/** True once the reveal (morph) step has started or passed. */
export function isRevealed(state: PlayerState): boolean {
  if (state.status === "done") return true;
  const revealIdx = state.choreography.steps.findIndex((s) => s.kind === "reveal");
  return revealIdx !== -1 && state.stepIndex >= revealIdx;
}

/** The narration line to show now (the narrate step's line once reached), or null. */
export function narration(state: PlayerState): string | null {
  if (state.status === "done") {
    const last = state.choreography.steps[state.choreography.steps.length - 1];
    return last?.line ?? null;
  }
  const s = currentStep(state);
  return s?.kind === "narrate" ? (s.line ?? null) : null;
}
