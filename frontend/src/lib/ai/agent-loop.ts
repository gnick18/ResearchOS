// BeakerBot agent loop (ai tools bot, 2026-06-10).
//
// The core upgrade, BeakerBot can now CALL TOOLS. The loop runs IN THE BROWSER
// (design doc section 6), so only per-turn context leaves the device, never bulk
// data and never a key. Each turn we send the running messages plus the tool
// definitions to the proxy with stream:false and read the provider JSON. If the
// model returns tool_calls we run each tool LOCALLY, append the assistant message
// and one tool result per call, and loop again. When the model returns plain
// content with no tool_calls that is the final answer.
//
// Why non-streaming, reliably capturing tool_calls out of an SSE stream is fragile
// (deltas split mid-JSON across frames), so the loop uses stream:false and the
// provider returns a single complete message. True token streaming of the FINAL
// answer is a later polish, the panel fakes it with a light client-side reveal.
//
// A HARD max-iteration guard caps the tool rounds, so a misbehaving model that
// keeps calling tools forever cannot spin. When the cap trips we stop with a
// graceful message instead of looping.
//
// This module is kept pure enough to unit-test by injecting a fake model caller
// and fake tools. It imports nothing from React and nothing from the network, the
// caller passes the function that talks to the proxy.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { toToolDefinition, type AiTool } from "./tools/types";
import { buildToolMap } from "./tools/registry";

// An OpenAI-compatible chat message. Tool plumbing needs the extra fields beyond
// the plain { role, content } the foundation slice used. Content is nullable
// because an assistant message that only calls tools carries no text.
export type LoopMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  // Present on an assistant message that calls tools.
  tool_calls?: ToolCall[];
  // Present on a tool result message, links it back to the originating call.
  tool_call_id?: string;
  // Convenience for tool messages, not sent upstream as a separate field.
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    // The provider returns arguments as a JSON STRING, parsed at dispatch.
    arguments: string;
  };
};

// The shape the proxy returns for a stream:false request, the relevant slice of an
// OpenAI-compatible chat completion.
export type ModelResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
};

// The function the loop calls to talk to the model. Injected, so tests pass a fake
// and production passes the proxy-backed caller. It receives the full message
// history and the provider-facing tool definitions and returns the parsed JSON.
export type ModelCaller = (
  messages: LoopMessage[],
  tools: ReturnType<typeof toToolDefinition>[],
) => Promise<ModelResponse>;

// Lightweight status the panel renders while the loop runs. "thinking" is a model
// turn in flight, "tool" is a tool executing (the panel can name it, like
// "checking your tasks").
export type LoopStatus =
  | { phase: "thinking" }
  | { phase: "tool"; toolName: string };

export type RunAgentLoopOptions = {
  messages: LoopMessage[];
  tools: AiTool[];
  callModel: ModelCaller;
  // Hard cap on tool rounds, so a runaway model cannot loop forever.
  maxIterations?: number;
  // Optional status callback for the panel.
  onStatus?: (status: LoopStatus) => void;
};

export type RunAgentLoopResult = {
  // The final assistant text to render.
  answer: string;
  // How many model turns ran, for tests and telemetry.
  iterations: number;
  // True when the loop stopped because it hit maxIterations, not a clean answer.
  stoppedOnGuard: boolean;
  // The full message history including tool calls and results, for the panel to
  // continue the conversation from.
  messages: LoopMessage[];
};

const DEFAULT_MAX_ITERATIONS = 5;

const GUARD_MESSAGE =
  "BeakerBot stopped after several steps without reaching a clear answer. Try asking again, or narrow the question.";

// Run a tool by name, defending against an unknown name and a malformed arguments
// string, so one bad call never throws the whole loop. The result is always a
// JSON-serializable value the loop can stringify into a tool message.
async function runToolCall(
  call: ToolCall,
  toolMap: Map<string, AiTool>,
): Promise<unknown> {
  const tool = toolMap.get(call.function.name);
  if (!tool) {
    return { error: `Unknown tool "${call.function.name}".` };
  }
  let args: Record<string, unknown> = {};
  if (call.function.arguments && call.function.arguments.trim().length > 0) {
    try {
      const parsed = JSON.parse(call.function.arguments);
      if (parsed && typeof parsed === "object") {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      return { error: "Tool arguments were not valid JSON." };
    }
  }
  try {
    return await tool.execute(args);
  } catch (err) {
    // Surface a compact error back to the model instead of crashing the loop, so
    // it can recover or tell the user plainly.
    const message = err instanceof Error ? err.message : "Tool execution failed.";
    return { error: message };
  }
}

/** Run the browser-side agent loop to completion. Sends messages + tool defs to
 *  the injected model caller, executes any tool_calls locally, feeds results back,
 *  and returns the final assistant answer. Stops cleanly at the max-iteration
 *  guard. */
export async function runAgentLoop(
  options: RunAgentLoopOptions,
): Promise<RunAgentLoopResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const toolDefs = options.tools.map(toToolDefinition);
  const toolMap = buildToolMap(options.tools);
  // Work on a copy, so the caller's array is never mutated.
  const messages: LoopMessage[] = [...options.messages];

  let iterations = 0;
  while (iterations < maxIterations) {
    iterations += 1;
    options.onStatus?.({ phase: "thinking" });

    const response = await options.callModel(messages, toolDefs);
    const message = response.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      // No tool calls means this is the final answer.
      const answer = (message?.content ?? "").trim();
      messages.push({ role: "assistant", content: answer });
      return { answer, iterations, stoppedOnGuard: false, messages };
    }

    // Record the assistant turn that requested the tools, then run each and append
    // its result. Both are required by the provider contract, the assistant
    // tool_calls message and a matching tool message per call.
    messages.push({
      role: "assistant",
      content: message?.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      options.onStatus?.({ phase: "tool", toolName: call.function.name });
      const result = await runToolCall(call, toolMap);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result),
      });
    }
    // Loop again so the model can read the tool results and either call more tools
    // or produce the final answer.
  }

  // Hit the guard, stop gracefully rather than spinning.
  messages.push({ role: "assistant", content: GUARD_MESSAGE });
  return {
    answer: GUARD_MESSAGE,
    iterations,
    stoppedOnGuard: true,
    messages,
  };
}
