// agent-loop approval gate tests (ai click tests bot, 2026-06-11).
//
// Extends the existing agent-loop suite with the approval gate introduced by the
// BeakerBot click + autonomy slice. Every safety property is asserted through
// runAgentLoop with injected fakes (callModel, action tool, requestApproval), so
// no real DOM and no real model are involved.
//
// Safety properties pinned:
//   1. "ask" autonomy pauses and calls requestApproval before execute.
//   2. Decision "allow" -> execute runs after approval.
//   3. Decision "skip" -> execute does NOT run; a graceful declined result is
//      fed back to the model.
//   4. "auto" autonomy + non-destructive -> execute runs directly, no approval.
//   5. "auto" autonomy + destructive tool -> requestApproval IS called (the
//      hard-stop overrides auto).
//   6. No requestApproval injected while a gated action is needed -> action is
//      DECLINED (execute never runs). This is the fail-safe.
//   7. getAutonomy absent -> defaults to "ask" (gated action requires approval).
//   8. Read-only tools (action falsy) run with no approval, same as before.
//   9. The existing loop behaviors (final answer, max-iteration guard, unknown
//      tool, bad-JSON args) still pass (covered by agent-loop.test.ts; this
//      file only adds the gate behaviors).
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

/** Builds a minimal action tool with a fake execute. `isDestructiveOverride` lets
 *  tests force the tool to report itself as destructive without a real heuristic. */
function makeActionTool(opts: {
  name?: string;
  executeResult?: unknown;
  isDestructiveOverride?: boolean;
}): { tool: AiTool; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => opts.executeResult ?? { ok: true });
  const tool: AiTool = {
    name: opts.name ?? "do_thing",
    description: "An action tool for testing.",
    parameters: { type: "object", properties: {} },
    action: true,
    describeAction: (_args) => ({ summary: "do the thing", ref: "bb-1" }),
    isDestructive:
      opts.isDestructiveOverride !== undefined
        ? () => opts.isDestructiveOverride!
        : undefined,
    execute,
  };
  return { tool, execute };
}

const USER_MESSAGE: LoopMessage = { role: "user", content: "do the thing" };

// ---- safety property 1 + 2: ask + allow ------------------------------------

describe("approval gate: ask autonomy", () => {
  it("calls requestApproval before execute when autonomy is 'ask'", async () => {
    const { tool, execute } = makeActionTool({});
    const requestApproval = vi.fn(
      async (_req: ApprovalRequest): Promise<ApprovalDecision> => "allow",
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    // requestApproval was called before execute ran.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    // The request carries the tool name and the action summary.
    const req: ApprovalRequest = requestApproval.mock.calls[0][0];
    expect(req.toolName).toBe("do_thing");
    expect(typeof req.summary).toBe("string");
    // execute ran because the decision was "allow".
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("execute runs after an 'allow' decision", async () => {
    const { tool, execute } = makeActionTool({ executeResult: { value: 42 } });
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- safety property 3: ask + skip ------------------------------------------

describe("approval gate: skip decision", () => {
  it("execute does NOT run when the user skips", async () => {
    const { tool, execute } = makeActionTool({});
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => "skip",
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("understood"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("feeds a graceful 'declined' result back to the model when the user skips", async () => {
    const { tool } = makeActionTool({});
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "skip");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("understood"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    // The second model call should have received a tool message whose content
    // reports the decline so the model can respond gracefully.
    const secondCallMessages = callModel.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: LoopMessage) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg?.content as string) as {
      approved: boolean;
      message: string;
    };
    expect(parsed.approved).toBe(false);
    expect(parsed.message).toMatch(/declined|skipped|user/i);
  });
});

// ---- safety property 4: auto + non-destructive -> no approval ---------------

describe("approval gate: auto autonomy", () => {
  it("execute runs directly without calling requestApproval when auto + non-destructive", async () => {
    // isDestructive is false (default, no override).
    const { tool, execute } = makeActionTool({ isDestructiveOverride: false });
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "auto",
      requestApproval,
    });

    // requestApproval was never called, execute ran directly.
    expect(requestApproval).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- safety property 5: auto + destructive -> approval hard-stop ------------

describe("approval gate: auto + destructive hard-stop", () => {
  it("calls requestApproval even in auto mode when isDestructive returns true", async () => {
    const { tool, execute } = makeActionTool({ isDestructiveOverride: true });
    const requestApproval = vi.fn(
      async (_req: ApprovalRequest): Promise<ApprovalDecision> => "allow",
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "auto",
      requestApproval,
    });

    // The hard-stop overrides auto: approval was requested.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    // The approval request carries the destructive flag.
    const req: ApprovalRequest = requestApproval.mock.calls[0][0];
    expect(req.destructive).toBe(true);
    // The user allowed, so execute ran.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("execute does NOT run for a destructive-auto action when the user skips", async () => {
    const { tool, execute } = makeActionTool({ isDestructiveOverride: true });
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "skip");

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("ok"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "auto",
      requestApproval,
    });

    expect(execute).not.toHaveBeenCalled();
  });
});

// ---- safety property 6: no approver -> action is declined (fail-safe) -------

describe("approval gate: no requestApproval injected", () => {
  it("declines the action (execute never runs) when no approver is available", async () => {
    const { tool, execute } = makeActionTool({});

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("ok"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "ask",
      // requestApproval is intentionally not provided.
    });

    // The fail-safe: no approver means the action is never performed.
    expect(execute).not.toHaveBeenCalled();
  });

  it("feeds a 'no approval path' message back to the model", async () => {
    const { tool } = makeActionTool({});

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("ok"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "ask",
    });

    const secondCallMessages = callModel.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: LoopMessage) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg?.content as string) as {
      approved: boolean;
      message: string;
    };
    expect(parsed.approved).toBe(false);
    // The message should mention that no approval path is available.
    expect(parsed.message).toMatch(/approval|approver|not performed/i);
  });
});

// ---- safety property 7: getAutonomy absent -> defaults to "ask" -------------

describe("approval gate: getAutonomy absent", () => {
  it("defaults to 'ask' when getAutonomy is not provided", async () => {
    const { tool, execute } = makeActionTool({});
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => "allow",
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      // getAutonomy is absent, so the loop must default to "ask".
      requestApproval,
    });

    // Defaulting to "ask" means requestApproval was called.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ---- safety property 8: read-only tools run with no approval ----------------

describe("approval gate: read-only tools", () => {
  it("runs a tool without action flag immediately, no approval needed", async () => {
    const execute = vi.fn(async () => ({ data: "found" }));
    const readOnlyTool: AiTool = {
      name: "read_data",
      description: "Read only.",
      parameters: { type: "object", properties: {} },
      // action is absent (falsy), so this is a read-only tool.
      execute,
    };
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => "allow",
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("read_data", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [readOnlyTool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
    });

    // The read-only tool ran without any approval.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requestApproval).not.toHaveBeenCalled();
  });
});

// ---- onStatus emits awaiting-approval while paused --------------------------

describe("onStatus during approval", () => {
  it("emits 'awaiting-approval' status while waiting for the user in ask mode", async () => {
    const { tool } = makeActionTool({});
    const statuses: string[] = [];
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => "allow",
    );

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("do_thing", {}))
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [USER_MESSAGE],
      tools: [tool],
      callModel,
      getAutonomy: () => "ask",
      requestApproval,
      onStatus: (s) => statuses.push(s.phase),
    });

    expect(statuses).toContain("awaiting-approval");
  });
});
