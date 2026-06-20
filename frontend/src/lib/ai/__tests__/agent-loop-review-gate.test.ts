// agent-loop review-mode gate decision-table tests (ai review-mode bot,
// 2026-06-12).
//
// Pins the EXACT gate decision table that replaced the ask/auto autonomy gate.
// This is safety-critical, so every branch is asserted through runAgentLoop with
// injected fakes (callModel, tools, requestApproval, getReviewMode), no real DOM
// and no real model.
//
// The table under test (gateToolCall in agent-loop.ts):
//   - NOT action AND NOT previewable -> PROCEED (pure read-only).
//   - DESTRUCTIVE -> ALWAYS confirm, in BOTH modes, even with planState.approved.
//   - step mode -> confirm EVERY action OR previewable call.
//   - plan mode:
//       - previewable and NOT action -> PROCEED (instant tools run free).
//       - action -> PROCEED when planState.approved, else a single confirm.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, type LoopMessage, type ModelResponse } from "../agent-loop";
import type { AiTool, ApprovalDecision, ApprovalRequest } from "../tools/types";
import { proposePlanTool } from "../tools/propose-plan";

// ---- helpers ----------------------------------------------------------------

function assistantWithToolCall(
  name: string,
  args: object,
  callId = "call_1",
): ModelResponse {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: callId,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

function assistantFinal(content: string): ModelResponse {
  return { choices: [{ message: { role: "assistant", content } }] };
}

/** A read-only tool, neither action nor previewable. */
function makeReadOnlyTool(): { tool: AiTool; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ data: "x" }));
  return {
    execute,
    tool: {
      name: "read_thing",
      description: "Read only.",
      parameters: { type: "object", properties: {} },
      execute,
    },
  };
}

/** An action tool (write_note style), optionally destructive. */
function makeActionTool(opts: { destructive?: boolean } = {}): {
  tool: AiTool;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => ({ ok: true }));
  return {
    execute,
    tool: {
      name: "do_action",
      description: "An action tool.",
      parameters: { type: "object", properties: {} },
      action: true,
      describeAction: () => ({ summary: "do the action" }),
      isDestructive: opts.destructive ? () => true : undefined,
      execute,
    },
  };
}

/** An immutable action tool (click_element style): an action that changes nothing
 *  in the user's data (navigate, click a nav link or tab), optionally with a
 *  destructive-looking target. */
function makeImmutableActionTool(opts: { destructive?: boolean } = {}): {
  tool: AiTool;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => ({ ok: true }));
  return {
    execute,
    tool: {
      name: "click_nav",
      description: "An immutable nav action.",
      parameters: { type: "object", properties: {} },
      action: true,
      immutable: true,
      describeAction: () => ({ summary: "click the Data Hub link" }),
      isDestructive: opts.destructive ? () => true : undefined,
      execute,
    },
  };
}

/** A previewable tool (run_datahub_analysis style), not an action, optionally
 *  destructive (a contrived case used only to prove the hard-stop fires even on
 *  a previewable tool). */
function makePreviewableTool(opts: { destructive?: boolean } = {}): {
  tool: AiTool;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => ({ ok: true }));
  return {
    execute,
    tool: {
      name: "run_preview",
      description: "A previewable analysis tool.",
      parameters: { type: "object", properties: {} },
      previewable: true,
      describeAction: () => ({ summary: "run the analysis" }),
      isDestructive: opts.destructive ? () => true : undefined,
      execute,
    },
  };
}

const USER: LoopMessage = { role: "user", content: "go" };

/** Run a single tool call to completion and report what the gate did. */
async function runOnce(opts: {
  tool: AiTool;
  reviewMode: "step" | "plan";
  approve?: ApprovalDecision;
  withApprover?: boolean;
}): Promise<{ requests: ApprovalRequest[] }> {
  const requests: ApprovalRequest[] = [];
  const requestApproval = vi.fn(
    async (req: ApprovalRequest): Promise<ApprovalDecision> => {
      requests.push(req);
      return opts.approve ?? "allow";
    },
  );
  const callModel = vi
    .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
    .mockResolvedValueOnce(assistantWithToolCall(opts.tool.name, {}))
    .mockResolvedValueOnce(assistantFinal("done"));

  await runAgentLoop({
    messages: [USER],
    tools: [opts.tool],
    callModel,
    getReviewMode: () => opts.reviewMode,
    ...(opts.withApprover === false ? {} : { requestApproval }),
  });
  return { requests };
}

// ---- read-only proceeds (both modes) ----------------------------------------

describe("gate decision table: pure read-only", () => {
  it("proceeds with no confirm in step mode", async () => {
    const { tool, execute } = makeReadOnlyTool();
    const { requests } = await runOnce({ tool, reviewMode: "step" });
    expect(requests).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("proceeds with no confirm in plan mode", async () => {
    const { tool, execute } = makeReadOnlyTool();
    const { requests } = await runOnce({ tool, reviewMode: "plan" });
    expect(requests).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- immutable action proceeds without a per-step confirm -------------------

describe("gate decision table: immutable action (navigation / show-around)", () => {
  it("proceeds with NO confirm in step mode (keeps step-by-step usable)", async () => {
    const { tool, execute } = makeImmutableActionTool();
    const { requests } = await runOnce({ tool, reviewMode: "step" });
    expect(requests).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("proceeds with no confirm in plan mode", async () => {
    const { tool, execute } = makeImmutableActionTool();
    const { requests } = await runOnce({ tool, reviewMode: "plan" });
    expect(requests).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("STILL confirms when the immutable target looks destructive, in both modes", async () => {
    for (const reviewMode of ["step", "plan"] as const) {
      const { tool, execute } = makeImmutableActionTool({ destructive: true });
      const { requests } = await runOnce({ tool, reviewMode, approve: "allow" });
      expect(requests).toHaveLength(1);
      expect(requests[0].kind).toBe("action");
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });
});

// ---- destructive hard-stop confirms in BOTH modes ---------------------------

describe("gate decision table: destructive hard-stop", () => {
  it("confirms a destructive action in step mode", async () => {
    const { tool, execute } = makeActionTool({ destructive: true });
    const { requests } = await runOnce({ tool, reviewMode: "step" });
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("action");
    if (requests[0].kind === "action") expect(requests[0].destructive).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirms a destructive action in plan mode", async () => {
    const { tool, execute } = makeActionTool({ destructive: true });
    const { requests } = await runOnce({ tool, reviewMode: "plan" });
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("action");
    if (requests[0].kind === "action") expect(requests[0].destructive).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirms a destructive step in plan mode EVEN AFTER the plan was approved", async () => {
    // propose_plan first (sets planState.approved), then a destructive action.
    // The hard-stop must still raise its own confirm, two approvals total.
    const { tool, execute } = makeActionTool({ destructive: true });
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return "allow";
      },
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Delete it"] }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_action", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].kind).toBe("plan");
    expect(requests[1].kind).toBe("action");
    if (requests[1].kind === "action") expect(requests[1].destructive).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirms even a previewable tool when it reports itself destructive (both modes)", async () => {
    for (const reviewMode of ["step", "plan"] as const) {
      const { tool, execute } = makePreviewableTool({ destructive: true });
      const { requests } = await runOnce({ tool, reviewMode });
      expect(requests, `mode ${reviewMode}`).toHaveLength(1);
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });
});

// ---- step mode confirms action AND previewable ------------------------------

describe("gate decision table: step mode confirms every step", () => {
  it("confirms a non-destructive action tool", async () => {
    const { tool, execute } = makeActionTool();
    const { requests } = await runOnce({ tool, reviewMode: "step" });
    expect(requests).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirms a previewable tool (the instant analysis/plot tools gate in step mode)", async () => {
    const { tool, execute } = makePreviewableTool();
    const { requests } = await runOnce({ tool, reviewMode: "step" });
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("action");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does NOT run a previewable tool when the user skips in step mode", async () => {
    const { tool, execute } = makePreviewableTool();
    const { requests } = await runOnce({
      tool,
      reviewMode: "step",
      approve: "skip",
    });
    expect(requests).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("an approved plan runs its non-destructive steps free in step mode (auto-plan elevation)", async () => {
    // propose_plan approved THIS turn, then a non-destructive action. With the
    // auto-plan elevation (auto-plan-offer 2026-06-19 spec, Part B), the approved
    // plan card IS the consent, so the step runs WITHOUT a second per-step confirm
    // even though the persisted mode is step. Only ONE approval is raised (the plan).
    const { tool, execute } = makeActionTool();
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return "allow";
      },
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Do it"] }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_action", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("plan");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("an approved plan STILL hard-stops a destructive step in step mode", async () => {
    // The elevation never bypasses the destructive hard-stop. propose_plan approved,
    // then a DESTRUCTIVE action, which raises its own confirm even inside the plan,
    // so this raises TWO approvals (plan + the destructive step).
    const { tool, execute } = makeActionTool({ destructive: true });
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return "allow";
      },
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Delete it"] }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_action", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].kind).toBe("plan");
    expect(requests[1].kind).toBe("action");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- plan mode: previewable runs free, action gates on plan approval --------

describe("gate decision table: plan mode", () => {
  it("runs a previewable tool free (no confirm) in plan mode", async () => {
    const { tool, execute } = makePreviewableTool();
    const { requests } = await runOnce({ tool, reviewMode: "plan" });
    expect(requests).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("runs an action tool free WHEN the plan was approved", async () => {
    // propose_plan approved (sets planState.approved), then a non-destructive
    // action runs with NO second confirm, one approval total (the plan).
    const { tool, execute } = makeActionTool();
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return "allow";
      },
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Do it"] }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_action", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("plan");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirms an action tool ONCE when the plan was NOT approved (lone-step fallback)", async () => {
    const { tool, execute } = makeActionTool();
    const { requests } = await runOnce({ tool, reviewMode: "plan" });
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("action");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- step-payload rich block (previewable analysis / plot / model tools) ----

/** A previewable tool whose describeAction returns a `stepPayload`, the rich
 *  block the analysis / plot / model tools raise in step-by-step mode. */
function makeStepPayloadTool(): {
  tool: AiTool;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => ({ ok: true }));
  return {
    execute,
    tool: {
      name: "run_step_preview",
      description: "A previewable tool that emits a rich step block.",
      parameters: { type: "object", properties: {} },
      previewable: true,
      describeAction: () => ({
        summary: "run the analysis",
        stepPayload: {
          kind: "step",
          toolName: "run_step_preview",
          iconName: "chart",
          title: "Run a Welch t-test",
          subtitle: "on Control vs Drug in fakeGFP",
          steps: [
            {
              kind: "run_step_preview",
              name: "Welch t-test",
              blurb: "Statistical test of Control vs Drug.",
              params: [{ label: "Test", value: "Welch t-test" }],
              previewLines: ["Assumptions, Normality OK."],
            },
          ],
        },
      }),
      execute,
    },
  };
}

describe("gate decision table: step-payload rich block", () => {
  it("raises a kind:step request in step mode and runs on approve", async () => {
    const { tool, execute } = makeStepPayloadTool();
    const { requests } = await runOnce({ tool, reviewMode: "step", approve: "allow" });
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("step");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not run the tool when the step is rejected", async () => {
    const { tool, execute } = makeStepPayloadTool();
    const { requests } = await runOnce({ tool, reviewMode: "step", approve: "skip" });
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("step");
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs free in plan mode (previewable non-action, no confirm)", async () => {
    const { tool, execute } = makeStepPayloadTool();
    const { requests } = await runOnce({ tool, reviewMode: "plan" });
    expect(requests).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- no approver -> declined fail-safe (a gating call) ----------------------

describe("gate decision table: no approver", () => {
  it("declines a previewable tool in step mode when no approver is wired", async () => {
    const { tool, execute } = makePreviewableTool();
    const { requests } = await runOnce({
      tool,
      reviewMode: "step",
      withApprover: false,
    });
    expect(requests).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
