// BeakerBot workflow macro runner (BeakerAI lane, 2026-06-13).
//
// Phase 2 of the workflow-macros feature. Replays a saved macro's steps in order,
// deterministically, WITHOUT the model in the loop. The happy path never calls
// the model, so a macro run is fast and runs exactly the steps the user saved,
// it cannot drift into a different action.
//
// Safety is NOT re-implemented here. The runner reuses the agent loop's own
// gateToolCall, the single gate every tool flows through, with the deps set for a
// macro run.
//   - reviewMode is forced to "plan" and planState.approved starts true, because
//     the caller already raised the one Run-card approval before calling runMacro.
//     So routine action and previewable steps replay without re-asking.
//   - The destructive hard-stop inside gateToolCall is absolute and still fires
//     per step, so a step that sends, shares, deletes, or pays STILL pops its own
//     confirm at the moment it runs, even inside an approved macro. This is the
//     same guarantee propose_plan gives, reused, not copied.
//
// Outcomes.
//   - A step whose tool is no longer registered is SKIPPED with a visible
//     "dangling" status (the tool was renamed or removed), the run continues.
//   - A step the user declines at its destructive confirm is SKIPPED, the run
//     continues (Skip drops just that step).
//   - A step whose execute throws FAILS and STOPS the run, the caller reports
//     which step failed. A failed step never silently continues.
//   - A disabled step (enabled === false) is not run at all and emits no event.
//
// This module is pure enough to unit-test with a fake tool list and a fake
// approval bridge, it imports nothing from React and nothing from the network.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  type AiTool,
  type ApprovalRequest,
  type ApprovalDecision,
} from "./tools/types";
import { buildToolMap } from "./tools/registry";
import { gateToolCall, type GateDeps } from "./agent-loop";
import type { MacroStep, StoredMacro } from "./beaker-macros-store";

// The lifecycle status of a single macro step. "running" is emitted before the
// step executes so a live panel can show progress, the others are terminal.
export type MacroStepStatus =
  | "running"
  | "done"
  | "skipped"
  | "skipped-dangling"
  | "failed";

// One step event, emitted through onStep so the UI can render progress. `index`
// is the position in macro.steps (disabled steps keep their index, they are just
// never emitted). `result` is the tool's return value on "done", `error` is the
// message on "failed".
export type MacroStepEvent = {
  index: number;
  step: MacroStep;
  status: MacroStepStatus;
  result?: unknown;
  error?: string;
};

export type RunMacroOptions = {
  /** The macro to replay (only its name and steps are read). */
  macro: Pick<StoredMacro, "name" | "steps">;
  /** The resolved registry tools available this run. */
  tools: AiTool[];
  /**
   * The approval bridge, used ONLY for the destructive hard-stop confirms a step
   * may raise mid-run. The macro-level Run approval is the caller's job, raised
   * before runMacro, so this is not asked for routine steps. When absent, a step
   * that would need a confirm is skipped (the gate declines safely).
   */
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Live progress callback, fired once with "running" then once with a terminal
   *  status per executed step. */
  onStep?: (event: MacroStepEvent) => void;
  /** Abort the run between steps. A run that aborts stops cleanly, mid-step work
   *  already dispatched is not interrupted. */
  signal?: AbortSignal;
};

export type RunMacroResult = {
  /** The terminal outcome of every step that ran, in order ("running" events are
   *  not included here, only the final status of each). */
  outcomes: MacroStepEvent[];
  /** True when every enabled step ran to a terminal non-failure status without an
   *  abort. Skipped and dangling steps do not break completion. */
  completed: boolean;
  /** The index of the step that failed and stopped the run, or null. */
  failedAt: number | null;
  /** True when the run was aborted by the signal before finishing. */
  aborted: boolean;
};

// Replay a macro's steps in order. See the module header for the full contract.
export async function runMacro(
  options: RunMacroOptions,
): Promise<RunMacroResult> {
  const toolMap = buildToolMap(options.tools);
  const outcomes: MacroStepEvent[] = [];

  // Macro-run gate deps. plan mode + approved means routine steps replay without
  // re-asking, the destructive hard-stop in gateToolCall still overrides per step.
  const deps: GateDeps = {
    getReviewMode: () => "plan",
    requestApproval: options.requestApproval,
    planState: { approved: true },
  };

  let failedAt: number | null = null;
  let aborted = false;

  const emit = (event: MacroStepEvent) => {
    if (event.status !== "running") outcomes.push(event);
    options.onStep?.(event);
  };

  for (let index = 0; index < options.macro.steps.length; index++) {
    const step = options.macro.steps[index];

    // A disabled step is not part of this run at all.
    if (step.enabled === false) continue;

    // Honor an abort requested between steps.
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }

    // A step whose tool is gone (renamed or removed) is skipped, not fatal.
    const tool = toolMap.get(step.tool);
    if (!tool) {
      emit({ index, step, status: "skipped-dangling" });
      continue;
    }

    emit({ index, step, status: "running" });

    // Gate the step. A throw inside the gate (for example a broken approval
    // bridge) is treated as a failure that stops the run, never propagated.
    let gate: Awaited<ReturnType<typeof gateToolCall>>;
    try {
      gate = await gateToolCall(tool, step.args, deps);
    } catch (gateErr) {
      const error =
        gateErr instanceof Error
          ? gateErr.message
          : gateErr != null
            ? String(gateErr)
            : "Step gate check failed.";
      emit({ index, step, status: "failed", error });
      failedAt = index;
      break;
    }

    // The user declined this step's destructive confirm. Skip it and continue,
    // exactly as the mockup's "Skip this step".
    if (!gate.proceed) {
      emit({ index, step, status: "skipped" });
      continue;
    }

    // Run the tool. A throw fails the step and stops the whole run, the caller
    // reports which step failed. err may be undefined/null/non-Error, normalize
    // it (a thrown undefined must never escape, see the agent-loop note).
    try {
      const result = await tool.execute(step.args);
      emit({ index, step, status: "done", result });
    } catch (err) {
      const error =
        err instanceof Error
          ? err.message
          : err != null
            ? String(err)
            : "Step execution failed.";
      emit({ index, step, status: "failed", error });
      failedAt = index;
      break;
    }
  }

  return {
    outcomes,
    completed: !aborted && failedAt === null,
    failedAt,
    aborted,
  };
}

// Build the one-line assistant message that BeakerBot posts after a macro run.
// Pure, so the wording is unit-tested and the store action just renders it.
// Counts come from the terminal outcomes, the tool counts deterministically and
// the message only narrates, never invents a number (the no-interpretation rule).
export function summarizeMacroRun(
  macroName: string,
  result: RunMacroResult,
): string {
  const token = `/${macroName}`;
  const done = result.outcomes.filter((o) => o.status === "done").length;
  const skipped = result.outcomes.filter(
    (o) => o.status === "skipped" || o.status === "skipped-dangling",
  ).length;

  const stepWord = (n: number) => `${n} step${n === 1 ? "" : "s"}`;

  if (result.aborted) {
    return `Stopped ${token} early. ${stepWord(done)} ran before you stopped it.`;
  }

  if (result.failedAt !== null) {
    const failed = result.outcomes.find((o) => o.status === "failed");
    const label = failed?.step.label ?? `step ${result.failedAt + 1}`;
    const reason = failed?.error ? `, it failed (${failed.error})` : "";
    return `Ran ${token} and stopped at "${label}"${reason}. ${stepWord(done)} ran before it.`;
  }

  const tail = skipped > 0 ? `, ${skipped} skipped` : "";
  return `Ran ${token}. ${stepWord(done)} done${tail}.`;
}
