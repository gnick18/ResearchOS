// BeakerBot tool layer types (ai tools bot, 2026-06-10).
//
// A tool is the unit the agent loop dispatches. The model is told each tool's
// name, description, and JSON-Schema parameters, and when it decides to call one
// the loop looks the tool up by name and runs `execute`. Keeping the shape this
// small is the whole point, adding the next tool later (a wiki search, a write
// tool behind approval) is just one more object in the registry, no loop change.
//
// Design doc section 1, the LLM orchestrates and never computes the truth. These
// definitions are what the model is handed. The read-only guarantee lives in the
// `execute` implementations, the loop itself imposes no write capability because
// no write tool exists yet.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

// A JSON-Schema object describing a tool's arguments. Kept loose on purpose, the
// provider only needs a plain JSON Schema object, and over-typing it here would
// fight every tool's bespoke shape.
export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

// A single tool BeakerBot can call. `execute` receives the parsed argument object
// the model produced and returns a result that is JSON-serialized back into the
// conversation as the tool message. Results should be compact and model-friendly,
// not raw store records.
export type AiTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

// The wire shape the provider expects for tool definitions (OpenAI-compatible
// `tools` array). The loop maps each AiTool to this before sending, stripping the
// `execute` function, which must never leave the browser.
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

/** Strip an AiTool down to the provider-facing definition. The `execute`
 *  function is intentionally dropped, only name, description, and the JSON Schema
 *  cross the wire. */
export function toToolDefinition(tool: AiTool): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
