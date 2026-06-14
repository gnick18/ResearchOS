// agent-loop per-step plan driving tests (resumable plan card, 2026-06-13).
//
// Opt-in (drivePlanPerStep) behavior: after a plan is approved, the LOOP drives
// the steps one at a time instead of letting the model free-run them. The loop
// owns the step boundaries, so progress ticks are exact and resume is
// model-independent. The unchanged free-run path is covered by agent-loop-plan.
//
// Pinned:
//   1. Driven run advances one step per model text turn, injecting the next step,
//      and fires onPlanProgress running 0..n then done.
//   2. The next-step directive names the correct step.
//   3. An abort mid-plan returns planRun active with the reached index, so the
//      caller can resume from there.
//   4. The destructive hard-stop still fires for a destructive step inside a
//      driven plan.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  runAgentLoop,
  type LoopMessage,
  type ModelResponse,
  type PlanProgress,
} from "../agent-loop";
import type { AiTool, ApprovalDecision, ApprovalRequest } from "../tools/types";
import { proposePlanTool } from "../tools/propose-plan";

function withToolCall(name: string, args: object, id = "c1"): ModelResponse {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}
function finalText(content: string): ModelResponse {
  return { choices: [{ message: { role: "assistant", content } }] };
}
function actionTool(destructive = false): { tool: AiTool; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ ok: true }));
  return {
    execute,
    tool: {
      name: "do_thing",
      description: "An action tool.",
      parameters: { type: "object", properties: {} },
      action: true,
      describeAction: () => ({ summary: "do the thing", ref: "bb-1" }),
      isDestructive: destructive ? () => true : undefined,
      execute,
    },
  };
}
const USER: LoopMessage = { role: "user", content: "set things up" };

describe("driven plan: advances one step per text turn", () => {
  it("ticks each step and injects the next, finishing done", async () => {
    const { tool, execute } = actionTool();
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");
    const progress: PlanProgress[] = [];

    // plan(2 steps) -> step1 tool -> "step1 done" -> step2 tool -> "step2 done".
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(withToolCall("propose_plan", { steps: ["Open the method", "Create the experiment"] }))
      .mockResolvedValueOnce(withToolCall("do_thing", {}, "c2"))
      .mockResolvedValueOnce(finalText("Step 1 is done."))
      .mockResolvedValueOnce(withToolCall("do_thing", {}, "c3"))
      .mockResolvedValueOnce(finalText("Step 2 is done."));

    const result = await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
      drivePlanPerStep: true,
      onPlanProgress: (p) => progress.push(p),
    });

    // Both steps' actions ran, the plan only asked for one approval (the plan).
    expect(execute).toHaveBeenCalledTimes(2);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    // Progress went 0 running, 1 running, 2 done.
    expect(progress.map((p) => `${p.index}:${p.status}`)).toEqual([
      "0:running",
      "1:running",
      "2:done",
    ]);
    // The plan finished (not left active).
    expect(result.planRun?.active).toBe(false);
  });

  it("injects a directive naming the next step", async () => {
    const { tool } = actionTool();
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(withToolCall("propose_plan", { steps: ["First step", "Second step"] }))
      .mockResolvedValueOnce(finalText("First step done."))
      .mockResolvedValueOnce(finalText("Second step done."));

    await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
      drivePlanPerStep: true,
    });

    // The third model call should have received the injected "step 2" directive.
    const thirdCallMessages = callModel.mock.calls[2][0];
    const injected = thirdCallMessages.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("Second step"),
    );
    expect(injected).toBeDefined();
    expect(injected?.content).toContain("step 2 of 2");
  });
});

describe("driven plan: resume after interruption", () => {
  it("returns planRun active at the reached index when aborted mid-plan", async () => {
    const { tool } = actionTool();
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");
    const controller = new AbortController();

    // After step 1's text turn the loop advances to step 2 and asks the model
    // again; abort right then so the run stops with step 2 pending.
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(withToolCall("propose_plan", { steps: ["Step one", "Step two", "Step three"] }))
      .mockResolvedValueOnce(finalText("Step one done."))
      .mockImplementationOnce(async () => {
        // A real aborted model call rejects with an AbortError, which the loop
        // catches and returns from cleanly (it does not advance the step).
        controller.abort();
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      });

    const result = await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
      drivePlanPerStep: true,
      signal: controller.signal,
    });

    // Stopped with the plan still active, resumable from step 2 (index 1).
    expect(result.planRun?.active).toBe(true);
    expect(result.planRun?.index).toBe(1);
  });
});

describe("driven plan: resume from a stopped step", () => {
  it("continues from the seeded index without a fresh approval and finishes", async () => {
    const { tool, execute } = actionTool();
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");
    const progress: PlanProgress[] = [];

    // Resume a 3-step plan from step 2 (index 1). The caller injects the step-2
    // directive; the loop seeds planRun + treats the plan as already approved.
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(withToolCall("do_thing", {}, "r2"))
      .mockResolvedValueOnce(finalText("Step two done."))
      .mockResolvedValueOnce(withToolCall("do_thing", {}, "r3"))
      .mockResolvedValueOnce(finalText("Step three done."));

    const result = await runAgentLoop({
      messages: [
        { role: "user", content: 'Resume the plan. Do step 2 of 3: "Step two".' },
      ],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
      drivePlanPerStep: true,
      initialPlanRun: { steps: ["Step one", "Step two", "Step three"], index: 1, active: true },
      onPlanProgress: (p) => progress.push(p),
    });

    // No fresh approval (it was approved the first time), routine steps ran free.
    expect(requestApproval).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
    // Advanced from step 2 to step 3, then done.
    expect(progress.map((p) => `${p.index}:${p.status}`)).toEqual(["2:running", "3:done"]);
    expect(result.planRun?.active).toBe(false);
  });
});

describe("driven plan: destructive hard-stop still fires", () => {
  it("confirms a destructive step inside a driven plan", async () => {
    const { tool, execute } = actionTool(true);
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(async (req: ApprovalRequest): Promise<ApprovalDecision> => {
      requests.push(req);
      return "allow";
    });
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(withToolCall("propose_plan", { steps: ["Delete the old run"] }))
      .mockResolvedValueOnce(withToolCall("do_thing", {}, "c2"))
      .mockResolvedValueOnce(finalText("Deleted."));

    await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
      drivePlanPerStep: true,
    });

    // Plan approval + the destructive action confirm both fired.
    expect(requests.map((r) => r.kind)).toEqual(["plan", "action"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
