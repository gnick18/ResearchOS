// agent-loop Canvas draft-save gate tests (ai canvas bot, 2026-06-13).
//
// Canvas is the editable surface over a model-proposed draft. Save resolves the
// draft approval with a draft-save decision carrying the user's EDITED content,
// and the gate calls the draft's applyEdit(args, content) BEFORE proceed so
// execute() writes the edited text rather than the model's original. These tests
// pin that path through runAgentLoop with injected fakes (no DOM, no model).
//
// Properties pinned:
//   1. A draft tool raises a kind:"draft" approval carrying the model's content.
//   2. A draft-save decision calls applyEdit(args, editedContent) and execute
//      then runs with the EDITED content in its own arg (the consent path).
//   3. A "skip" decision (Discard) does NOT run execute (the reject path).
//   4. When applyEdit is absent (older draft tools), a draft-save still proceeds
//      and execute runs with the model's ORIGINAL content (no regression).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, type LoopMessage, type ModelResponse } from "../agent-loop";
import type { AiTool, ApprovalDecision, ApprovalRequest } from "../tools/types";

function assistantWithToolCall(name: string, args: object): ModelResponse {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
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

/** A draft-write tool whose execute records the content arg it actually saw, so a
 *  test can assert the edited content reached it. applyEdit writes the edited
 *  string into args.content (the arg execute reads). */
function makeDraftTool(opts: { withApplyEdit: boolean }): {
  tool: AiTool;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async (args: Record<string, unknown>) => ({
    ok: true,
    saved: args.content,
  }));
  const tool: AiTool = {
    name: "write_note",
    description: "A draft-write tool for testing.",
    parameters: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
    action: true,
    isDestructive: () => false,
    describeAction: (args) => ({
      summary: "write a note",
      draft: {
        content: typeof args.content === "string" ? args.content : "",
        mode: "create",
        title: "Test draft",
        ...(opts.withApplyEdit
          ? {
              applyEdit: (a: Record<string, unknown>, edited: string) => {
                a.content = edited;
              },
            }
          : {}),
      },
    }),
    execute,
  };
  return { tool, execute };
}

const USER: LoopMessage = { role: "user", content: "summarize into a note" };

describe("Canvas draft gate", () => {
  it("raises a kind:'draft' approval carrying the model's drafted content", async () => {
    const { tool } = makeDraftTool({ withApplyEdit: true });
    const requestApproval = vi.fn(
      async (_req: ApprovalRequest): Promise<ApprovalDecision> => "skip",
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", { content: "Original draft." }),
      )
      .mockResolvedValueOnce(assistantFinal("ok"));

    await runAgentLoop({
      messages: [USER],
      tools: [tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    expect(requestApproval).toHaveBeenCalledTimes(1);
    const req = requestApproval.mock.calls[0][0];
    expect(req.kind).toBe("draft");
    if (req.kind === "draft") {
      expect(req.content).toBe("Original draft.");
      expect(req.toolName).toBe("write_note");
    }
  });

  it("a draft-save decision writes the EDITED content into the tool's args, then execute runs with it", async () => {
    const { tool, execute } = makeDraftTool({ withApplyEdit: true });
    // The user edited the draft in Canvas, then saved. Save resolves a draft-save
    // decision carrying the edited buffer.
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => ({
        kind: "draft-save",
        content: "Edited in Canvas.",
      }),
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", { content: "Original draft." }),
      )
      .mockResolvedValueOnce(assistantFinal("saved"));

    await runAgentLoop({
      messages: [USER],
      tools: [tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    // execute ran (Save is the consent) and saw the EDITED content, not the
    // model's original.
    expect(execute).toHaveBeenCalledTimes(1);
    const sawArgs = execute.mock.calls[0][0] as { content: string };
    expect(sawArgs.content).toBe("Edited in Canvas.");
  });

  it("a 'skip' decision (Discard) does NOT run execute", async () => {
    const { tool, execute } = makeDraftTool({ withApplyEdit: true });
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "skip");
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", { content: "Original draft." }),
      )
      .mockResolvedValueOnce(assistantFinal("understood"));

    await runAgentLoop({
      messages: [USER],
      tools: [tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("falls back to the model's ORIGINAL content when applyEdit is absent (no regression)", async () => {
    const { tool, execute } = makeDraftTool({ withApplyEdit: false });
    // Even though the decision carries edited content, a tool with no applyEdit
    // cannot route it, so execute writes the original args unchanged.
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => ({
        kind: "draft-save",
        content: "This edit cannot be applied.",
      }),
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", { content: "Original draft." }),
      )
      .mockResolvedValueOnce(assistantFinal("saved"));

    await runAgentLoop({
      messages: [USER],
      tools: [tool],
      callModel,
      getReviewMode: () => "step",
      requestApproval,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const sawArgs = execute.mock.calls[0][0] as { content: string };
    expect(sawArgs.content).toBe("Original draft.");
  });
});
