// agent-loop ask_user tests (ai ask-user bot, 2026-06-11).
//
// The structured-choice flow. BeakerBot calls ask_user with a question and a set
// of options, the loop raises a "choice" request on the SAME pause/resume bridge
// the plan and action confirms use, and the user's selection comes back to the
// model as the tool result. Single-select returns the one option, multi-select
// returns the array, and a dismiss returns a graceful "no choice".
//
// Every property is asserted through runAgentLoop with injected fakes (callModel,
// requestApproval), so no real DOM and no real model are involved. ask_user is a
// coordination tool, the loop owns it by name, so it never flows through the
// per-action approval gate.
//
// Properties pinned:
//   1. ask_user raises a "choice" request carrying the question, options, select,
//      and count.
//   2. Single-select resolves with the one chosen option, the model receives it
//      as `selected` (a string), chosen true.
//   3. Multi-select resolves with the picked array as `selected`, chosen true.
//   4. A dismiss (cancelled) returns a graceful chosen false result, the model is
//      never handed an invented pick.
//   5. ask_user never flows through the per-action gate, no action approval is
//      raised for it.
//   6. Degenerate input (no question, or fewer than two options) returns a
//      graceful result without raising a request, and with no approver it
//      declines safely.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, type LoopMessage, type ModelResponse } from "../agent-loop";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChoiceDecision,
} from "../tools/types";
import { askUserTool } from "../tools/ask-user";

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

function choice(selected: string[]): ChoiceDecision {
  return { kind: "choice", selected, cancelled: false };
}

const USER_MESSAGE: LoopMessage = { role: "user", content: "run a t-test" };

/** Read the single tool result message the model would see on its next turn. */
function lastToolResult(
  callModel: ReturnType<typeof vi.fn>,
  turn: number,
): Record<string, unknown> {
  const messages = callModel.mock.calls[turn][0] as LoopMessage[];
  const toolMsg = messages.find((m) => m.role === "tool");
  return JSON.parse(toolMsg?.content as string) as Record<string, unknown>;
}

// ---- property 1 + 2: single-select raises a choice and returns the option ----

describe("ask_user: single-select", () => {
  it("raises a 'choice' request with the question and options, then returns the picked option", async () => {
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return choice(["Growth assay"]);
      },
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("ask_user", {
          question: "Which table?",
          options: ["qPCR", "Growth assay"],
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Using the Growth assay table."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [askUserTool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    // Exactly one choice request, carrying the question and options.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requests[0].kind).toBe("choice");
    if (requests[0].kind === "choice") {
      expect(requests[0].question).toBe("Which table?");
      expect(requests[0].options).toEqual(["qPCR", "Growth assay"]);
      expect(requests[0].select).toBe("one");
    }

    // The model received the single chosen option as a string.
    const result = lastToolResult(callModel, 1);
    expect(result.chosen).toBe(true);
    expect(result.selected).toBe("Growth assay");
  });
});

// ---- property 1 + 3: multi-select with count returns the array --------------

describe("ask_user: multi-select with count", () => {
  it("passes the count through and returns the picked array", async () => {
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return choice(["Control", "Drug A"]);
      },
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("ask_user", {
          question: "Which two groups?",
          options: ["Control", "Drug A", "Drug B"],
          select: "multiple",
          count: 2,
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Comparing Control and Drug A."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [askUserTool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    expect(requests[0].kind).toBe("choice");
    if (requests[0].kind === "choice") {
      expect(requests[0].select).toBe("multiple");
      expect(requests[0].count).toBe(2);
    }

    const result = lastToolResult(callModel, 1);
    expect(result.chosen).toBe(true);
    expect(result.selected).toEqual(["Control", "Drug A"]);
  });
});

// ---- property 4: dismiss returns a graceful no-choice -----------------------

describe("ask_user: dismiss", () => {
  it("returns a graceful 'no choice' result and never invents a pick", async () => {
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => ({
        kind: "choice",
        selected: [],
        cancelled: true,
      }),
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("ask_user", {
          question: "Which two groups?",
          options: ["Control", "Drug A", "Drug B"],
          select: "multiple",
          count: 2,
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Okay, let me know which groups."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [askUserTool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    const result = lastToolResult(callModel, 1);
    expect(result.chosen).toBe(false);
    expect(result.selected).toBeUndefined();
    expect(String(result.message)).toMatch(/dismiss|ask again|do not choose/i);
  });
});

// ---- property 5: ask_user does not flow through the per-action gate ----------

describe("ask_user: not an action", () => {
  it("never raises an action approval (it is a coordination tool owned by name)", async () => {
    const requests: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        requests.push(req);
        return choice(["Yes"]);
      },
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("ask_user", {
          question: "Proceed?",
          options: ["Yes", "No"],
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Proceeding."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [askUserTool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    // The one request raised was a choice, never an action confirm.
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("choice");
  });
});

// ---- property 6: degenerate inputs ------------------------------------------

describe("ask_user: degenerate inputs", () => {
  it("returns a graceful result and raises no request when there are fewer than two options", async () => {
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => choice(["only"]),
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("ask_user", {
          question: "Which?",
          options: ["only one"],
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Let me look again."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [askUserTool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    expect(requestApproval).not.toHaveBeenCalled();
    const result = lastToolResult(callModel, 1);
    expect(result.chosen).toBe(false);
  });

  it("declines safely when no approver is available", async () => {
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("ask_user", {
          question: "Which?",
          options: ["A", "B"],
        }),
      )
      .mockResolvedValueOnce(assistantFinal("I cannot ask without a panel."));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [askUserTool],
      callModel,
      getAutonomy: () => "ask",
      // requestApproval intentionally absent.
    });

    const result = lastToolResult(callModel, 1);
    expect(result.chosen).toBe(false);
    expect(String(result.message)).toMatch(/no input path|ask the user/i);
  });
});
