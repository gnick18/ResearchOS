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

  it("fires onToolResult with the raw result and strips _ui from the model-facing tool message", async () => {
    // A tool that returns a model-facing shape PLUS an out-of-band _ui record-set.
    const fakeTool: AiTool = {
      name: "list_records",
      description: "List records.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        ok: true,
        count: 1,
        items: [{ id: "1" }],
        _ui: {
          kind: "list_records",
          title: "Records",
          total: 1,
          items: [{ type: "note", id: "1", title: "First" }],
        },
      }),
    };

    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(assistantWithToolCall("list_records", {}))
      .mockResolvedValueOnce(assistantFinal("Listed."));

    const onToolResult = vi.fn();

    const result = await runAgentLoop({
      messages: [{ role: "user", content: "list" }],
      tools: [fakeTool],
      callModel,
      onToolResult,
    });

    // onToolResult sees the RAW result, still carrying _ui, plus the tool name + args.
    expect(onToolResult).toHaveBeenCalledTimes(1);
    const [toolName, args, raw] = onToolResult.mock.calls[0];
    expect(toolName).toBe("list_records");
    expect(args).toEqual({});
    expect((raw as { _ui?: unknown })._ui).toBeDefined();

    // The tool message the MODEL saw on turn 2 has the _ui key stripped.
    const secondTurnMessages = callModel.mock.calls[1][0];
    const toolMessage = secondTurnMessages.find((m) => m.role === "tool");
    const parsed = JSON.parse(toolMessage?.content as string);
    expect(parsed._ui).toBeUndefined();
    expect(parsed).toEqual({ ok: true, count: 1, items: [{ id: "1" }] });
    expect(result.answer).toBe("Listed.");
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

  // ---- Token usage accumulation (STAGE 1, 2026-06-13) -----------------------

  it("totalUsage starts at zero when the provider returns no usage block", async () => {
    const callModel = vi.fn(async () => assistantFinal("hello"));
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callModel,
    });
    // Zero when usage is absent, never NaN or undefined.
    expect(result.totalUsage.promptTokens).toBe(0);
    expect(result.totalUsage.completionTokens).toBe(0);
  });

  it("totalUsage accumulates across multiple iterations", async () => {
    const fakeTool: AiTool = {
      name: "lookup",
      description: "Look something up.",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      execute: async () => ({ result: "found" }),
    };

    // Turn 1: tool call, usage { prompt: 100, completion: 20 }.
    const turn1: ModelResponse = {
      ...assistantWithToolCall("lookup", { q: "test" }),
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    };
    // Turn 2: final answer, usage { prompt: 150, completion: 50 }.
    const turn2: ModelResponse = {
      ...assistantFinal("The answer."),
      usage: { prompt_tokens: 150, completion_tokens: 50 },
    };

    const callModel = vi.fn().mockResolvedValueOnce(turn1).mockResolvedValueOnce(turn2);

    const usageCalls: Array<{ promptTokens: number; completionTokens: number }> = [];
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "look up test" }],
      tools: [fakeTool],
      callModel,
      onUsage: (cumulative) => { usageCalls.push({ ...cumulative }); },
    });

    // Final totalUsage must be the sum of both iterations.
    expect(result.totalUsage.promptTokens).toBe(250);
    expect(result.totalUsage.completionTokens).toBe(70);

    // onUsage was called once per iteration that reported non-zero usage.
    expect(usageCalls).toHaveLength(2);
    // After turn 1: cumulative = 100 + 20.
    expect(usageCalls[0]).toEqual({ promptTokens: 100, completionTokens: 20 });
    // After turn 2: cumulative = 250 + 70.
    expect(usageCalls[1]).toEqual({ promptTokens: 250, completionTokens: 70 });
  });

  it("onUsage is not called when the usage block is empty or zero", async () => {
    const turn1: ModelResponse = {
      ...assistantFinal("hi"),
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
    const callModel = vi.fn().mockResolvedValueOnce(turn1);
    const onUsage = vi.fn();

    await runAgentLoop({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callModel,
      onUsage,
    });

    // Zero usage must not trigger the callback (avoids a 0-token live update).
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("onUsage is not called when usage is absent from the response", async () => {
    const callModel = vi.fn(async () => assistantFinal("ok"));
    const onUsage = vi.fn();

    await runAgentLoop({
      messages: [{ role: "user", content: "ok" }],
      tools: [],
      callModel,
      onUsage,
    });

    expect(onUsage).not.toHaveBeenCalled();
  });
});
