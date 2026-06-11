import { describe, expect, it, vi } from "vitest";
import {
  runAgentLoop,
  type LoopMessage,
  type ModelResponse,
} from "../agent-loop";
import type { AiTool } from "../tools/types";

// Pins for the browser agent loop. The model caller is injected, so these are
// deterministic, no network and no real model. They assert:
//   - a tool_call on turn 1 runs the tool LOCALLY with the parsed args, the result
//     is fed back as a tool message, and the turn-2 final answer surfaces;
//   - the tool definitions handed to the model carry name/description/parameters
//     but never the execute function;
//   - the max-iteration guard trips on a model that calls a tool forever.

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

describe("runAgentLoop", () => {
  it("executes a requested tool with parsed args, feeds the result back, and surfaces the final answer", async () => {
    const execute = vi.fn(async (args: Record<string, unknown>) => ({
      echoed: args.q,
    }));
    const fakeTool: AiTool = {
      name: "lookup",
      description: "Look something up.",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      execute,
    };

    // Turn 1 asks for the tool, turn 2 gives the final answer.
    const callModel = vi
      .fn<
        (m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>
      >()
      .mockResolvedValueOnce(assistantWithToolCall("lookup", { q: "hello" }))
      .mockResolvedValueOnce(assistantFinal("Here is your answer."));

    const result = await runAgentLoop({
      messages: [{ role: "user", content: "look up hello" }],
      tools: [fakeTool],
      callModel,
      maxIterations: 5,
    });

    // The tool ran once with the parsed arguments object.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ q: "hello" });

    // Two model turns, the final answer surfaced, the guard did not trip.
    expect(result.iterations).toBe(2);
    expect(result.stoppedOnGuard).toBe(false);
    expect(result.answer).toBe("Here is your answer.");

    // The second model call saw the tool result fed back as a tool message.
    const secondTurnMessages = callModel.mock.calls[1][0];
    const toolMessage = secondTurnMessages.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_1");
    expect(JSON.parse(toolMessage?.content as string)).toEqual({
      echoed: "hello",
    });
  });

  it("hands the model tool definitions without the execute function", async () => {
    const fakeTool: AiTool = {
      name: "lookup",
      description: "Look something up.",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      execute: async () => ({}),
    };
    const callModel = vi
      .fn<
        (m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>
      >()
      .mockResolvedValueOnce(assistantFinal("done"));

    await runAgentLoop({
      messages: [{ role: "user", content: "hi" }],
      tools: [fakeTool],
      callModel,
    });

    const toolDefs = callModel.mock.calls[0][1] as Array<{
      type: string;
      function: { name: string; description: string; parameters: unknown };
    }>;
    expect(toolDefs).toHaveLength(1);
    expect(toolDefs[0].type).toBe("function");
    expect(toolDefs[0].function.name).toBe("lookup");
    expect(toolDefs[0].function.description).toBe("Look something up.");
    // No execute field crosses the wire.
    expect(
      (toolDefs[0].function as Record<string, unknown>).execute,
    ).toBeUndefined();
    expect((toolDefs[0] as Record<string, unknown>).execute).toBeUndefined();
  });

  it("trips the max-iteration guard when the model loops on tools forever", async () => {
    const fakeTool: AiTool = {
      name: "spin",
      description: "Always called.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    };
    // The model always asks for the tool again, never returns a final answer.
    const callModel = vi.fn(async () =>
      assistantWithToolCall("spin", {}),
    );

    const result = await runAgentLoop({
      messages: [{ role: "user", content: "go" }],
      tools: [fakeTool],
      callModel,
      maxIterations: 3,
    });

    expect(result.stoppedOnGuard).toBe(true);
    expect(result.iterations).toBe(3);
    expect(callModel).toHaveBeenCalledTimes(3);
    expect(result.answer).toMatch(/stopped after several steps/i);
  });

  it("returns a graceful error to the model for an unknown tool instead of throwing", async () => {
    const callModel = vi
      .fn<
        (m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>
      >()
      .mockResolvedValueOnce(assistantWithToolCall("does_not_exist", {}))
      .mockResolvedValueOnce(assistantFinal("recovered"));

    const result = await runAgentLoop({
      messages: [{ role: "user", content: "go" }],
      tools: [],
      callModel,
    });

    expect(result.answer).toBe("recovered");
    const toolMessage = callModel.mock.calls[1][0].find(
      (m) => m.role === "tool",
    );
    expect(JSON.parse(toolMessage?.content as string)).toHaveProperty("error");
  });
});
