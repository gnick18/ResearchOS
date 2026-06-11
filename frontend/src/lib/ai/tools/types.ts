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

// A request the agent loop surfaces to the UI before it proceeds. It comes in two
// shapes, distinguished by `kind`, so the panel can render the right control.
//
//   - kind "plan", BeakerBot is PROPOSING a whole plan up front (the new flow).
//     The user sees the human-readable steps and approves the lot once with
//     Approve / Cancel. On approve the loop runs every routine step with no
//     further asking. This is what propose_plan raises.
//   - kind "action", a single ACTION needs a final confirm at the moment it runs
//     (Allow / Skip). This is the destructive hard-stop (delete, send, share,
//     pay) that ALWAYS confirms, even inside an already-approved plan, and the
//     fallback per-action confirm for a lone action with no plan.
//
// Both describe what BeakerBot wants to do in plain words. The action shape can
// carry a perceived element ref so the UI spotlights the target before the user
// allows it. The loop awaits the user's answer through the resolver.
export type ApprovalRequest =
  | {
      kind: "plan";
      /** The tool that raised the proposal, for the UI to label the prompt. */
      toolName: string;
      /** The human-readable steps BeakerBot intends to run, in order, for
       *  example ["Go to the Methods page", "Click the New Method button"]. */
      steps: string[];
      /** An optional one-line summary of the whole plan. */
      summary?: string;
    }
  | {
      kind: "action";
      /** The tool that wants to run, for the UI to label the confirm. */
      toolName: string;
      /** A short human sentence, for example "click New method". Authored by the
       *  tool through `describeAction`, never raw arguments. */
      summary: string;
      /** When the action targets a perceived element, its ref, so the UI can
       *  spotlight it. Optional, not every future action has a DOM target. */
      ref?: string;
      /** True when the destructive hard-stop forced this confirm, so the UI can
       *  warn more firmly. */
      destructive?: boolean;
    };

// The UI's answer to an approval request. "allow" proceeds (run the action, or
// approve the plan), "skip" declines (do not run the action, or cancel the plan)
// and tells the model the user said no, so it can respond gracefully. The same
// two-value decision covers both Allow / Skip and Approve / Cancel, the panel
// just labels the buttons to match the request kind.
export type ApprovalDecision = "allow" | "skip";

// A single tool BeakerBot can call. `execute` receives the parsed argument object
// the model produced and returns a result that is JSON-serialized back into the
// conversation as the tool message. Results should be compact and model-friendly,
// not raw store records.
//
// An ACTION tool sets `action: true`. Action tools may CHANGE something (the
// first one is click_element, which dispatches a real click), so the agent loop
// routes them through the approval gate. A tool without `action` is treated as
// read-only and runs immediately, the way the perception and data-reader tools
// always have. New write tools (note writing, run_analysis) reuse this same flag
// and gate, no loop change per tool.
export type AiTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  /** When true, this tool performs an action and goes through the approval gate
   *  in the agent loop (propose-then-approve in "ask" mode, direct in "auto"
   *  mode, with a destructive hard-stop in both). Absent / false = read-only,
   *  runs immediately. */
  action?: boolean;
  /** For action tools, build the human approval summary and optional target ref
   *  from the parsed args, so the loop can show the user what will happen WITHOUT
   *  running the tool. Pure, never effectful. Optional, the loop falls back to a
   *  generic summary when absent. */
  describeAction?: (args: Record<string, unknown>) => {
    summary: string;
    ref?: string;
  };
  /** For action tools, decide whether THIS specific call must hard-stop for a
   *  confirm even in "auto" mode (the destructive safety net). Pure. Optional,
   *  absent = never forces a confirm beyond the autonomy setting. */
  isDestructive?: (args: Record<string, unknown>) => boolean;
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
