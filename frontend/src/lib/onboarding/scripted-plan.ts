// Onboarding tutor — the scripted AI-demo plan (increment 5, pure engine).
//
// The ONE chat-panel beat. Instead of a live model call, the AI demo replays a
// fixed, deterministic multi-step plan through the SAME resumable plan-card shape
// the real BeakerBot uses (ActivePlan), so the user sees Beaker propose a plan and
// tick it off step by step across the demo-mode Data Hub and Phylo. Deterministic
// means free (no tokens, the capped meter funds the user's first REAL turn after
// the tour) and reliable (it never errors mid-demo).
//
// This module owns the SCRIPT + a stepping reducer (mirrors showcase-player). It
// exposes two views: toActivePlan(state) feeds the real BeakerBotPlanCard
// unchanged, and the cue selectors (route / cursor target / narration) drive the
// presenter cursor moving between surfaces while the card ticks. Pure, no timers
// or DOM. House style, no em-dashes, no emojis, no mid-sentence colons.

import type { Surface } from "./reel-director";
// Type-only import (erased at build), so this stays free of the conversation
// store's runtime. The scripted plan PROJECTS onto the real card's ActivePlan.
import type { ActivePlan } from "@/lib/ai/conversation-store";

/** What a scripted step represents, so the view can pick the right surface verb
 *  and the cursor can land on the right control. */
export type ScriptedPlanKind = "create_table" | "analyze" | "plot" | "overlay";

export interface ScriptedPlanStep {
  id: string;
  /** The human sentence shown in the plan card, in the real propose_plan style. */
  sentence: string;
  /** The demo surface this step runs on. */
  surface: Surface;
  /** The route that surface lives on, so the cursor layer navigates when the
   *  step changes surface (Data Hub then Phylo). */
  route: string;
  /** The data-tutor-target the presenter cursor lands on, when the step has a
   *  tagged control. Omitted steps leave the cursor where it last rested. */
  target?: string;
  /** The coach-bubble narration while this step runs. */
  narration: string;
  kind: ScriptedPlanKind;
  /** How long this step runs before completing, ms. Deterministic timing. */
  durationMs: number;
}

/** Per-step lifecycle, mirroring the real plan card (pending then running then
 *  done). The card renders a tick once a step is done. */
export type ScriptedStepStatus = "pending" | "running" | "done";

// The script. A small, honest cross-surface workflow Beaker can run end to end on
// the seeded demo data: build a table, analyze it, plot the effect, then carry the
// result onto the tree. Narration stays flavor-neutral ("your data") so it reads
// right whatever field fixture the demo seeded; per-field tailoring can come later.
export const SCRIPTED_PLAN: ScriptedPlanStep[] = [
  {
    id: "create-table",
    sentence: "Put the readings into a Data Hub table",
    surface: "datahub",
    route: "/datahub",
    narration: "First I will lay your readings out as a table I can work on.",
    kind: "create_table",
    durationMs: 2400,
  },
  {
    id: "analyze",
    sentence: "Run a one-way ANOVA across the groups",
    surface: "datahub",
    route: "/datahub",
    target: "datahub-analyze-button",
    narration:
      "Then I pick the right test for this design and check its assumptions before running it.",
    kind: "analyze",
    durationMs: 2800,
  },
  {
    id: "plot",
    sentence: "Make an estimation plot of the effect",
    surface: "datahub",
    route: "/datahub",
    target: "datahub-plot-button",
    narration: "Now I turn the result into a figure you could drop into a paper.",
    kind: "plot",
    durationMs: 2600,
  },
  {
    id: "overlay",
    sentence: "Carry the result onto your tree as a data layer",
    surface: "phylo",
    route: "/phylo",
    narration:
      "And the same result can ride along your tree, lined up with each tip.",
    kind: "overlay",
    durationMs: 2800,
  },
];

export type ScriptedPlanStatus = "running" | "paused" | "done";

export interface ScriptedPlanState {
  plan: ScriptedPlanStep[];
  /** The 0-based step running now (equals plan.length once done). */
  stepIndex: number;
  /** Time accrued on the current step. */
  elapsedMs: number;
  status: ScriptedPlanStatus;
}

export function initScriptedPlan(
  plan: ScriptedPlanStep[] = SCRIPTED_PLAN,
): ScriptedPlanState {
  return { plan, stepIndex: 0, elapsedMs: 0, status: "running" };
}

export type ScriptedPlanAction =
  | { type: "tick"; deltaMs: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "skip" } // jump straight to done (the always-available exit)
  | { type: "restart" };

export function scriptedPlanReducer(
  state: ScriptedPlanState,
  action: ScriptedPlanAction,
): ScriptedPlanState {
  switch (action.type) {
    case "pause":
      return state.status === "running" ? { ...state, status: "paused" } : state;
    case "resume":
      return state.status === "paused" ? { ...state, status: "running" } : state;
    case "skip":
      return { ...state, stepIndex: state.plan.length, elapsedMs: 0, status: "done" };
    case "restart":
      return initScriptedPlan(state.plan);
    case "tick": {
      if (state.status !== "running") return state;
      const steps = state.plan;
      let stepIndex = state.stepIndex;
      let elapsed = state.elapsedMs + Math.max(0, action.deltaMs);
      // Advance across as many steps as the elapsed covers, so a big delta after a
      // dropped frame settles on the right step rather than overshooting silently.
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

/** The step running now, or null once the plan is done. */
export function currentScriptedStep(state: ScriptedPlanState): ScriptedPlanStep | null {
  return state.plan[state.stepIndex] ?? null;
}

/** The lifecycle of step `i` for the card render. Steps before the current one
 *  are done, the current one is running, later ones pending. Once the whole plan
 *  is done every step reads done. */
export function scriptedStepStatus(
  state: ScriptedPlanState,
  i: number,
): ScriptedStepStatus {
  if (state.status === "done") return "done";
  if (i < state.stepIndex) return "done";
  if (i === state.stepIndex) return "running";
  return "pending";
}

/** The control the presenter cursor should point at now (the current step's
 *  target, else the most recent earlier target so the cursor rests rather than
 *  snapping to nothing), or null before any target. */
export function scriptedCursorTarget(state: ScriptedPlanState): string | null {
  const upTo = Math.min(state.stepIndex, state.plan.length - 1);
  for (let i = upTo; i >= 0; i--) {
    const t = state.plan[i]?.target;
    if (t) return t;
  }
  return null;
}

/** The route the cursor layer should be on now, so it navigates when the plan
 *  crosses from Data Hub to Phylo. Holds the last route once done. */
export function scriptedRoute(state: ScriptedPlanState): string | null {
  if (state.status === "done") {
    return state.plan[state.plan.length - 1]?.route ?? null;
  }
  return currentScriptedStep(state)?.route ?? null;
}

/** The narration to show now (the current step's line, or the last step's once
 *  done), or null when there is no plan. */
export function scriptedNarration(state: ScriptedPlanState): string | null {
  if (state.status === "done") {
    return state.plan[state.plan.length - 1]?.narration ?? null;
  }
  return currentScriptedStep(state)?.narration ?? null;
}

/** True once the scripted plan has finished. */
export function isScriptedPlanComplete(state: ScriptedPlanState): boolean {
  return state.status === "done";
}

/**
 * Project the scripted state onto the real card's ActivePlan, so the demo renders
 * through the EXACT BeakerBotPlanCard component (steps as the human sentences,
 * index as the current/last step, status driving the ticking). The index is
 * clamped to the last step when done so the card highlights the final row rather
 * than an out-of-range index.
 */
export function toActivePlan(state: ScriptedPlanState): ActivePlan {
  const lastIndex = Math.max(0, state.plan.length - 1);
  return {
    steps: state.plan.map((s) => s.sentence),
    index: state.status === "done" ? lastIndex : Math.min(state.stepIndex, lastIndex),
    status: state.status,
    summary: "A quick end to end pass on your sample data",
  };
}
