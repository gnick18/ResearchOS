// agent-loop plan-approval tests (ai plan bot, 2026-06-11).
//
// The plan-first action flow. BeakerBot proposes the whole plan once with
// propose_plan, the user approves or cancels, and on approve the routine action
// tools in the SAME run execute without re-asking. The destructive hard-stop is
// the carve-out, it STILL confirms even inside an approved plan.
//
// Every property is asserted through runAgentLoop with injected fakes (callModel,
// action tool, requestApproval), so no real DOM and no real model are involved.
//
// The "approve a plan then run routine steps free" path is now whole-plan review
// mode (getReviewMode "plan"), so the property-2 tests run in plan mode. Step
// mode reviews every step instead and is covered by agent-loop-review-gate.test.
//
// Properties pinned:
//   1. propose_plan raises a "plan" approval request with the steps.
//   2. Approve in plan mode -> the run-level flag is set, a subsequent
//      non-destructive action runs WITHOUT its own confirm.
//   3. Cancel -> the action never runs, a graceful "cancelled" result reaches the
//      model.
//   4. A destructive step inside an approved plan STILL confirms (plan approval
//      does not bypass the hard-stop), and a skip there does not run it.
//   5. Fallback, a single action with NO propose_plan still per-action confirms.
//   6. The plan flag is per-run, it does not leak across separate runs.
//   7. propose_plan with no steps returns a graceful result without raising an
//      approval, and with no approver it declines safely.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, type LoopMessage, type ModelResponse } from "../agent-loop";
import type { AiTool } from "../tools/types";
import type { ApprovalDecision, ApprovalRequest } from "../tools/types";

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

function makeActionTool(opts: {
  name?: string;
  isDestructiveOverride?: boolean;
}): { tool: AiTool; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ ok: true }));
  const tool: AiTool = {
    name: opts.name ?? "do_thing",
    description: "An action tool for testing.",
    parameters: { type: "object", properties: {} },
    action: true,
    describeAction: () => ({ summary: "do the thing", ref: "bb-1" }),
    isDestructive:
      opts.isDestructiveOverride !== undefined
        ? () => opts.isDestructiveOverride!
        : undefined,
    execute,
  };
  return { tool, execute };
}

// The real propose_plan tool, so the loop's by-name special-casing is exercised.
import { proposePlanTool } from "../tools/propose-plan";

const USER_MESSAGE: LoopMessage = { role: "user", content: "open the form" };

// ---- property 1 + 2: propose_plan raises a plan, approve runs steps free -----

describe("plan flow: approve covers the routine steps", () => {
  it("raises a 'plan' approval with the steps, then runs a later action with no second confirm", async () => {
    const { tool, execute } = makeActionTool({});
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return "allow";
      },
    );

    // Turn 1, propose the plan. Turn 2, after approval, call the action. Turn 3,
    // final answer.
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", {
          steps: ["Go to the Methods page", "Click the New Method button"],
        }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("Opened the form."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel,
      // Whole-plan mode, an approved plan runs the routine steps free.
      getReviewMode: () => "plan",
      requestApproval,
    });

    // Exactly one approval was raised, the plan, NOT a per-action confirm.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requests[0].kind).toBe("plan");
    if (requests[0].kind === "plan") {
      expect(requests[0].steps).toEqual([
        "Go to the Methods page",
        "Click the New Method button",
      ]);
    }
    // The action ran, with no further confirm.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("feeds an 'approved true' result back to the model after approve", async () => {
    const { tool } = makeActionTool({});
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Step one"] }),
      )
      .mockResolvedValueOnce(assistantFinal("Done."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
    });

    const secondCallMessages = callModel.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: LoopMessage) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg?.content as string) as {
      approved: boolean;
    };
    expect(parsed.approved).toBe(true);
  });
});

// ---- property 3: cancel stops the plan --------------------------------------

describe("plan flow: cancel", () => {
  it("does not run the action and feeds a graceful 'cancelled' result when the user cancels", async () => {
    const { tool, execute } = makeActionTool({});
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "skip");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", {
          steps: ["Go to the Methods page", "Click New Method"],
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Okay, I will not do that."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    // The action never ran.
    expect(execute).not.toHaveBeenCalled();
    // A graceful cancelled result reached the model.
    const secondCallMessages = callModel.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: LoopMessage) => m.role === "tool");
    const parsed = JSON.parse(toolMsg?.content as string) as {
      approved: boolean;
      message: string;
    };
    expect(parsed.approved).toBe(false);
    expect(parsed.message).toMatch(/cancel/i);
  });
});

// ---- property 4: destructive hard-stop survives an approved plan ------------

describe("plan flow: destructive step still confirms inside an approved plan", () => {
  it("raises a second (action) confirm for a destructive step even after plan approval", async () => {
    const { tool, execute } = makeActionTool({ isDestructiveOverride: true });
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
        assistantWithToolCall("propose_plan", {
          steps: ["Delete the old run"],
        }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("Deleted it."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel,
      // Whole-plan mode, where an approved plan WOULD let routine steps run free,
      // so this proves the destructive hard-stop still confirms despite that.
      getReviewMode: () => "plan",
      requestApproval,
    });

    // Two approvals, the plan AND the destructive action confirm. Plan approval
    // did NOT bypass the hard-stop.
    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(requests[0].kind).toBe("plan");
    expect(requests[1].kind).toBe("action");
    if (requests[1].kind === "action") {
      expect(requests[1].destructive).toBe(true);
    }
    // The user allowed the destructive step, so it ran.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not run the destructive step when the user skips it inside an approved plan", async () => {
    const { tool, execute } = makeActionTool({ isDestructiveOverride: true });
    // Approve the plan, then skip the destructive confirm.
    const requestApproval = vi
      .fn<(req: ApprovalRequest) => Promise<ApprovalDecision>>()
      .mockResolvedValueOnce("allow")
      .mockResolvedValueOnce("skip");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Delete the run"] }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("I left it in place."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
    });

    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it("still confirms a destructive step inside an approved plan even in auto mode", async () => {
    const { tool, execute } = makeActionTool({ isDestructiveOverride: true });
    const requestApproval = vi
      .fn<(req: ApprovalRequest) => Promise<ApprovalDecision>>()
      .mockResolvedValueOnce("allow")
      .mockResolvedValueOnce("allow");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Delete the run"] }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("Deleted."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "plan",
      requestApproval,
    });

    // The destructive confirm fired (plan + destructive action), auto did not
    // silence it.
    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- property 5: fallback, single action with no plan still confirms --------

describe("plan flow: fallback per-action confirm with no plan", () => {
  it("a lone action in ask mode with no propose_plan still raises a per-action confirm", async () => {
    const { tool, execute } = makeActionTool({});
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return "allow";
      },
    );

    // No propose_plan call, the model goes straight to the action.
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    // The old behavior is intact, a per-action confirm was raised.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requests[0].kind).toBe("action");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- property 6: the plan flag is per-run -----------------------------------

describe("plan flow: approval does not leak across runs", () => {
  it("a second run with no fresh plan still confirms its action", async () => {
    const { tool, execute } = makeActionTool({});
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");

    // Run 1, approve a plan and run the action.
    const callModel1 = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Do it"] }),
      )
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}, "call_2"))
      .mockResolvedValueOnce(assistantFinal("done"));

    const result1 = await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool, tool],
      callModel: callModel1,
      getReviewMode: () => "plan",
      requestApproval,
    });

    // Run 2, carry the history forward but do NOT propose a fresh plan, go
    // straight to an action. It must confirm again (the flag did not leak).
    const callModel2 = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}, "call_3"))
      .mockResolvedValueOnce(assistantFinal("done again"));

    requestApproval.mockClear();

    await runAgentLoop({
      messages: [
        ...result1.messages,
        { role: "user", content: "do it again" },
      ],
      tools: [proposePlanTool, tool],
      callModel: callModel2,
      getReviewMode: () => "plan",
      requestApproval,
    });

    // The second run required its own confirm, plan approval did not carry over.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    // execute ran once per run.
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

// ---- property 7: degenerate propose_plan inputs -----------------------------

describe("plan flow: degenerate propose_plan inputs", () => {
  it("returns a graceful result and raises no approval when steps are empty", async () => {
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: [] }),
      )
      .mockResolvedValueOnce(assistantFinal("What would you like to do?"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    expect(requestApproval).not.toHaveBeenCalled();
    const secondCallMessages = callModel.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: LoopMessage) => m.role === "tool");
    const parsed = JSON.parse(toolMsg?.content as string) as {
      approved: boolean;
    };
    expect(parsed.approved).toBe(false);
  });

  it("declines safely when no approver is available", async () => {
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("propose_plan", { steps: ["Do it"] }),
      )
      .mockResolvedValueOnce(assistantFinal("I cannot act without your okay."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [proposePlanTool],
      callModel,
      getReviewMode: () => "step",
      // requestApproval intentionally absent.
    });

    const secondCallMessages = callModel.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: LoopMessage) => m.role === "tool");
    const parsed = JSON.parse(toolMsg?.content as string) as {
      approved: boolean;
      message: string;
    };
    expect(parsed.approved).toBe(false);
    expect(parsed.message).toMatch(/approval|approver/i);
  });
});
