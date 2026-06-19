import { describe, it, expect } from "vitest";
import {
  SCRIPTED_PLAN,
  initScriptedPlan,
  scriptedPlanReducer,
  currentScriptedStep,
  scriptedStepStatus,
  scriptedCursorTarget,
  scriptedRoute,
  scriptedNarration,
  isScriptedPlanComplete,
  toActivePlan,
  type ScriptedPlanState,
} from "./scripted-plan";

// Drive the reducer through a list of actions from a starting state.
function run(
  actions: Parameters<typeof scriptedPlanReducer>[1][],
  from: ScriptedPlanState = initScriptedPlan(),
): ScriptedPlanState {
  return actions.reduce(scriptedPlanReducer, from);
}

/** Total ms across every step, so a test can tick the whole plan to done. */
const TOTAL_MS = SCRIPTED_PLAN.reduce((n, s) => n + s.durationMs, 0);

describe("scripted-plan — the script", () => {
  it("runs create then analyze then plot then overlay, ending on Phylo", () => {
    expect(SCRIPTED_PLAN.map((s) => s.kind)).toEqual([
      "create_table",
      "analyze",
      "plot",
      "overlay",
    ]);
    expect(SCRIPTED_PLAN[0].surface).toBe("datahub");
    expect(SCRIPTED_PLAN[SCRIPTED_PLAN.length - 1].surface).toBe("phylo");
  });

  it("every step has a positive duration and a narration", () => {
    for (const s of SCRIPTED_PLAN) {
      expect(s.durationMs).toBeGreaterThan(0);
      expect(s.narration.length).toBeGreaterThan(0);
    }
  });
});

describe("scripted-plan — stepping", () => {
  it("starts running on the first step", () => {
    const s = initScriptedPlan();
    expect(s.status).toBe("running");
    expect(s.stepIndex).toBe(0);
    expect(currentScriptedStep(s)?.id).toBe("create-table");
  });

  it("advances one step once its dwell elapses", () => {
    const s = run([{ type: "tick", deltaMs: SCRIPTED_PLAN[0].durationMs }]);
    expect(s.stepIndex).toBe(1);
    expect(currentScriptedStep(s)?.kind).toBe("analyze");
  });

  it("a big delta settles on the right step without overshooting state", () => {
    const s = run([
      { type: "tick", deltaMs: SCRIPTED_PLAN[0].durationMs + SCRIPTED_PLAN[1].durationMs + 10 },
    ]);
    expect(s.stepIndex).toBe(2);
    expect(currentScriptedStep(s)?.kind).toBe("plot");
  });

  it("completes once every dwell elapses", () => {
    const s = run([{ type: "tick", deltaMs: TOTAL_MS }]);
    expect(s.status).toBe("done");
    expect(isScriptedPlanComplete(s)).toBe(true);
    expect(currentScriptedStep(s)).toBeNull();
  });

  it("pause freezes ticking; resume continues", () => {
    const paused = run([{ type: "pause" }, { type: "tick", deltaMs: TOTAL_MS }]);
    expect(paused.status).toBe("paused");
    expect(paused.stepIndex).toBe(0);
    const resumed = run([{ type: "tick", deltaMs: SCRIPTED_PLAN[0].durationMs }], {
      ...paused,
      status: "running",
    });
    expect(resumed.stepIndex).toBe(1);
  });

  it("skip jumps straight to done (always-available exit)", () => {
    const s = run([{ type: "skip" }]);
    expect(s.status).toBe("done");
    expect(isScriptedPlanComplete(s)).toBe(true);
  });

  it("restart returns to the first step", () => {
    const s = run([{ type: "tick", deltaMs: TOTAL_MS }, { type: "restart" }]);
    expect(s.status).toBe("running");
    expect(s.stepIndex).toBe(0);
  });
});

describe("scripted-plan — selectors", () => {
  it("marks earlier steps done, the current running, later pending", () => {
    const s = run([{ type: "tick", deltaMs: SCRIPTED_PLAN[0].durationMs }]);
    expect(scriptedStepStatus(s, 0)).toBe("done");
    expect(scriptedStepStatus(s, 1)).toBe("running");
    expect(scriptedStepStatus(s, 2)).toBe("pending");
  });

  it("marks every step done once the plan finishes", () => {
    const s = run([{ type: "skip" }]);
    SCRIPTED_PLAN.forEach((_, i) => expect(scriptedStepStatus(s, i)).toBe("done"));
  });

  it("cursor target follows tagged steps and rests across untagged ones", () => {
    // step 0 (create) has no target, so the cursor target is null at the start.
    const start = initScriptedPlan();
    expect(scriptedCursorTarget(start)).toBeNull();
    // step 1 (analyze) lands on the Analyze button.
    const atAnalyze = run([{ type: "tick", deltaMs: SCRIPTED_PLAN[0].durationMs }]);
    expect(scriptedCursorTarget(atAnalyze)).toBe("datahub-analyze-button");
    // step 2 (plot) lands on the New graph button.
    const atPlot = run([
      { type: "tick", deltaMs: SCRIPTED_PLAN[0].durationMs + SCRIPTED_PLAN[1].durationMs },
    ]);
    expect(scriptedCursorTarget(atPlot)).toBe("datahub-plot-button");
    // overlay (step 3) has no target, so the cursor rests on the last one (plot).
    const atOverlay = run([
      {
        type: "tick",
        deltaMs:
          SCRIPTED_PLAN[0].durationMs +
          SCRIPTED_PLAN[1].durationMs +
          SCRIPTED_PLAN[2].durationMs,
      },
    ]);
    expect(scriptedCursorTarget(atOverlay)).toBe("datahub-plot-button");
  });

  it("route follows the current step then holds the last route when done", () => {
    expect(scriptedRoute(initScriptedPlan())).toBe("/datahub");
    const atOverlay = run([
      {
        type: "tick",
        deltaMs:
          SCRIPTED_PLAN[0].durationMs +
          SCRIPTED_PLAN[1].durationMs +
          SCRIPTED_PLAN[2].durationMs,
      },
    ]);
    expect(scriptedRoute(atOverlay)).toBe("/phylo");
    const done = run([{ type: "skip" }]);
    expect(scriptedRoute(done)).toBe("/phylo");
  });

  it("narration follows the current step then holds the last line when done", () => {
    expect(scriptedNarration(initScriptedPlan())).toBe(SCRIPTED_PLAN[0].narration);
    const done = run([{ type: "skip" }]);
    expect(scriptedNarration(done)).toBe(SCRIPTED_PLAN[SCRIPTED_PLAN.length - 1].narration);
  });
});

describe("scripted-plan — toActivePlan projection (feeds the real card)", () => {
  it("maps sentences, index, and status for the live card", () => {
    const s = run([{ type: "tick", deltaMs: SCRIPTED_PLAN[0].durationMs }]);
    const plan = toActivePlan(s);
    expect(plan.steps).toEqual(SCRIPTED_PLAN.map((x) => x.sentence));
    expect(plan.index).toBe(1);
    expect(plan.status).toBe("running");
    expect(plan.summary).toBeTruthy();
  });

  it("clamps index to the last step and reports done at the end", () => {
    const plan = toActivePlan(run([{ type: "skip" }]));
    expect(plan.index).toBe(SCRIPTED_PLAN.length - 1);
    expect(plan.status).toBe("done");
  });

  it("reports paused status through to the card", () => {
    const plan = toActivePlan(run([{ type: "pause" }]));
    expect(plan.status).toBe("paused");
  });
});
