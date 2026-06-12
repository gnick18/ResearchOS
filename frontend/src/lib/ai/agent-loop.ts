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

import {
  toToolDefinition,
  isChoiceDecision,
  type AiTool,
  type ApprovalRequest,
  type ApprovalDecision,
} from "./tools/types";
import { buildToolMap } from "./tools/registry";
import {
  PROPOSE_PLAN_TOOL_NAME,
  readPlanSteps,
  readPlanSummary,
} from "./tools/propose-plan";
import { ASK_USER_TOOL_NAME, parseAskUserArgs } from "./tools/ask-user";
import type { BeakerBotReviewMode } from "./review-mode-store";

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
  | { phase: "tool"; toolName: string }
  // The loop is paused waiting for the user to approve an action. The panel uses
  // this to show "waiting for you" rather than a spinner.
  | { phase: "awaiting-approval"; toolName: string };

export type RunAgentLoopOptions = {
  messages: LoopMessage[];
  tools: AiTool[];
  callModel: ModelCaller;
  // Hard cap on tool rounds, so a runaway model cannot loop forever.
  maxIterations?: number;
  // Optional status callback for the panel.
  onStatus?: (status: LoopStatus) => void;
  // The user's review mode (step vs plan), read at dispatch time so the gate
  // respects the current setting. Injected (not imported) so the loop stays pure
  // and unit-tests with a fixed value. Defaults to "step", the safe mode, when
  // absent, so a missing option can never widen to unattended running.
  getReviewMode?: () => BeakerBotReviewMode;
  // The propose-then-approve bridge to the UI. The loop calls this for a step
  // that needs the user's blessing (every action and previewable step in "step"
  // mode, an unapproved action in "plan" mode, and always a destructive target).
  // It resolves with the user's decision.
  // Injected, so production wires it to the panel's confirm UI and tests pass a
  // fake. When absent, the loop treats every gated action as skipped, the safe
  // default (never act without an approver), so a misconfigured caller cannot
  // silently click.
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
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

// A whole-plan pipeline (filter, then a test, then a plot, then a note) runs
// several tools back to back, and each tool typically costs two rounds (a
// list_* read to resolve ids, then the tool itself), plus the plan round and a
// final summary. Five was too few and halted multi-step runs partway. Twelve
// covers a four-step pipeline with margin while still bounding a runaway model.
const DEFAULT_MAX_ITERATIONS = 12;

const GUARD_MESSAGE =
  "BeakerBot stopped after several steps without reaching a clear answer. Try asking again, or narrow the question.";

// The gate dependencies threaded into tool dispatch. Kept as a small bag so the
// dispatch signature stays readable as more is wired in. `planState` is a mutable
// per-run flag, propose_plan flips `approved` to true on Approve, and in PLAN
// mode once true the routine action tools in this run run WITHOUT re-asking (the
// destructive hard-stop still overrides it). In STEP mode planState.approved does
// NOT skip a confirm, every step is reviewed. It is an object, not a bare boolean,
// so the gate can mutate it in place across calls within one run.
type GateDeps = {
  getReviewMode: () => BeakerBotReviewMode;
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  planState: { approved: boolean };
};

// Parse a tool call's arguments string into an object, returning null on bad JSON
// so the caller can surface a clean error. An empty arguments string is a valid
// empty object.
function parseToolArgs(call: ToolCall): Record<string, unknown> | null {
  if (!call.function.arguments || call.function.arguments.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(call.function.arguments);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return null;
  }
}

// Handle the propose_plan coordination tool. It is the proposal step of the
// plan-first flow, NOT an action, so it never goes through the per-action gate.
// The loop shows the whole plan to the user with a single Approve / Cancel, and
// on Approve flips the run-level planState.approved so the routine action tools
// in this run run without re-asking (the destructive hard-stop still overrides
// that). The returned result is fed back to the model so it knows whether to
// proceed with the steps or stop.
async function handleProposePlan(
  args: Record<string, unknown>,
  deps: GateDeps,
): Promise<unknown> {
  const steps = readPlanSteps(args);
  const summary = readPlanSummary(args);

  // No steps to approve. Tell the model to ask plainly rather than present an
  // empty plan.
  if (steps.length === 0) {
    return {
      approved: false,
      message:
        "No steps were provided to plan. Ask the user what they would like to do, or guide them with guide_to_element instead.",
    };
  }

  // Without an approver we cannot present the plan, so decline safely, never act
  // without a human blessing the plan.
  if (!deps.requestApproval) {
    return {
      approved: false,
      message:
        "This plan needs the user's approval, but no approval path is available. Do not act, explain what you would do instead.",
    };
  }

  const decision = await deps.requestApproval({
    kind: "plan",
    toolName: PROPOSE_PLAN_TOOL_NAME,
    steps,
    ...(summary ? { summary } : {}),
  });

  if (decision === "allow") {
    // Approved, the routine steps in this run no longer re-ask.
    deps.planState.approved = true;
    return {
      approved: true,
      message:
        "The user approved the plan. Carry out the steps in order now using go_to_page, read_page, and click_element, without asking again. When done, confirm in one short sentence.",
    };
  }

  // Cancelled, stop and acknowledge. The flag stays false so nothing runs silently.
  return {
    approved: false,
    message:
      "The user cancelled the plan. Stop, do not perform any of the steps, and acknowledge their choice in one short sentence.",
  };
}

// Handle the ask_user coordination tool. Like propose_plan, the loop owns it by
// name, it is NOT an action and never flows through the per-action gate (there is
// nothing to approve, the user is choosing, not allowing). It raises a "choice"
// request on the SAME pause/resume bridge and returns the user's selection to the
// model so it continues with the real choice. A dismiss returns a graceful "no
// choice" result, the model must not invent a pick.
async function handleAskUser(
  args: Record<string, unknown>,
  deps: GateDeps,
): Promise<unknown> {
  const parsed = parseAskUserArgs(args);

  // No question or fewer than two options is not a real choice. Tell the model to
  // ask plainly rather than present a degenerate one-button prompt.
  if (parsed.question.length === 0 || parsed.options.length < 2) {
    return {
      chosen: false,
      message:
        "A choice needs a clear question and at least two options. Ask the user directly instead, or gather the options first (for example call list_datahub_tables to learn the real group names).",
    };
  }

  // Without an approver we cannot present the choice, so decline safely, never
  // pick on the user's behalf.
  if (!deps.requestApproval) {
    return {
      chosen: false,
      message:
        "This choice needs the user to pick, but no input path is available. Do not choose for them, ask the user directly how they would like to proceed.",
    };
  }

  const decision = await deps.requestApproval({
    kind: "choice",
    toolName: ASK_USER_TOOL_NAME,
    question: parsed.question,
    options: parsed.options,
    select: parsed.select,
    ...(parsed.count !== undefined ? { count: parsed.count } : {}),
  });

  // The choice bridge resolves with a richer value than allow / skip. A defensive
  // fall-through, if a non-choice decision ever comes back, treat it as no pick.
  if (!isChoiceDecision(decision) || decision.cancelled) {
    return {
      chosen: false,
      message:
        "The user dismissed the choice without picking. Do not choose for them, ask again or stop, whichever fits.",
    };
  }

  // Return the selection in a shape the model can use directly. For a single
  // pick, also surface the lone value as `selected` so a yes / no or single-table
  // choice is trivial to read.
  return {
    chosen: true,
    selected:
      parsed.select === "one" ? decision.selected[0] ?? null : decision.selected,
    message:
      "The user made their choice. Continue using exactly the option or options they picked, do not ask them to confirm it again.",
  };
}

// Decide whether a tool call needs the user's approval before it runs, and if
// so, ask. This is the reusable gate every gating tool flows through. The
// decision is driven by the tool's `action` flag, the tool's `previewable` flag,
// the tool's own `isDestructive` check, the run-level plan approval, and the
// user's review mode (step vs plan), NOT by anything hardcoded to clicking.
//
// The exact decision table (safety-critical, see the unit tests).
//   - NOT action AND NOT previewable -> PROCEED (pure read-only).
//   - DESTRUCTIVE -> ALWAYS require a confirm, in BOTH modes, even if a plan was
//     approved. The hard-stop is never bypassed.
//   - reviewMode === "step" -> require a confirm for EVERY action OR previewable
//     call. planState.approved does NOT skip it, each step is reviewed.
//   - reviewMode === "plan":
//       - previewable and NOT action -> PROCEED (the instant analysis/plot tools
//         run free in plan mode, preserving today's behavior).
//       - action -> PROCEED when planState.approved, else require a single confirm
//         (the existing plan-approval / single-confirm fallback).
//
// Returns one of.
//   - { proceed: true }  run the tool (read-only, plan-approved action, or an
//     instant previewable tool in plan mode)
//   - { proceed: false, result } do NOT run, feed `result` back to the model so
//     it can respond gracefully (the user skipped, or there is no approver)
async function gateToolCall(
  tool: AiTool,
  args: Record<string, unknown>,
  deps: GateDeps,
): Promise<{ proceed: true } | { proceed: false; result: unknown }> {
  // Pure read-only tools never gate, they run immediately, exactly as before.
  // A tool that is neither an action nor previewable changes nothing the user
  // needs to review.
  if (!tool.action && !tool.previewable) return { proceed: true };

  const reviewMode = deps.getReviewMode();
  const destructive = tool.isDestructive?.(args) === true;

  // Decide whether THIS call may PROCEED without a confirm, per the decision
  // table above. The destructive hard-stop is checked first and is absolute, it
  // ALWAYS confirms in both modes even inside an approved plan, so we only look
  // for a free pass when the step is not destructive.
  if (!destructive) {
    if (reviewMode === "plan") {
      // Whole-plan. An instant previewable tool that is not an action runs free
      // (today's behavior). A plan-approved action also runs free.
      if (tool.previewable && !tool.action) return { proceed: true };
      if (deps.planState.approved) return { proceed: true };
      // Otherwise fall through to the single-confirm lone-step fallback.
    }
    // Step-by-step always falls through to a per-step confirm, an approved plan
    // does NOT skip it, every action OR previewable step is reviewed.
  }

  // We reach here when a confirm is required. Without an approver we cannot
  // safely run, so decline and tell the model.
  if (!deps.requestApproval) {
    return {
      proceed: false,
      result: {
        approved: false,
        message:
          "This action needs the user's approval, but no approval path is available. The action was not performed.",
      },
    };
  }

  // Build the proposal from the tool's own describer, so the user sees what will
  // happen WITHOUT the tool running. Fall back to a generic summary.
  const described = tool.describeAction?.(args);
  const summary = described?.summary ?? `run ${tool.name}`;

  // A draft-preview action (write_note) raises a richer "draft" request, the
  // proposed note content rendered for review, instead of the one-line "action"
  // confirm. The user reads the actual text and Approves (allow) or Rejects (skip)
  // it before anything is written. Same bridge, same allow / skip resolution.
  if (described?.draft) {
    const draft = described.draft;
    const decision = await deps.requestApproval({
      kind: "draft",
      toolName: tool.name,
      content: draft.content,
      mode: draft.mode,
      ...(draft.title ? { title: draft.title } : {}),
      ...(draft.noteTitle ? { noteTitle: draft.noteTitle } : {}),
    });
    if (decision === "allow") return { proceed: true };
    return {
      proceed: false,
      result: {
        approved: false,
        message:
          "The user declined the draft. Do not write it. Acknowledge their choice in one short sentence and offer to revise it if they would like.",
      },
    };
  }

  // A transform-preview action (transform_table) raises a "transform" block-card
  // approval instead of a one-line confirm. The user reviews the step block(s),
  // param pills, and the live preview, then Approves or Rejects. Same allow / skip
  // resolution as the draft path; the card renders differently in the UI.
  if (described?.transformPayload) {
    const decision = await deps.requestApproval(described.transformPayload);
    if (decision === "allow") return { proceed: true };
    return {
      proceed: false,
      result: {
        approved: false,
        message:
          "The user declined the transform. Do not create the derived table. Acknowledge their choice in one short sentence and offer to adjust the transform if they would like.",
      },
    };
  }

  // A previewable analysis / plot / model step raises a "step" rich-block approval
  // (the same block UI as a transform, with a generic header and a readout
  // preview) instead of the one-line confirm. The user reviews the step label,
  // the input pills, and the preview, then Approves or Rejects. Same allow / skip
  // resolution as the draft and transform paths.
  if (described?.stepPayload) {
    const decision = await deps.requestApproval(described.stepPayload);
    if (decision === "allow") return { proceed: true };
    return {
      proceed: false,
      result: {
        approved: false,
        message:
          "The user declined this step. Do not run it. Acknowledge their choice in one short sentence and offer to adjust it if they would like.",
      },
    };
  }

  const decision = await deps.requestApproval({
    kind: "action",
    toolName: tool.name,
    summary,
    ...(described?.ref ? { ref: described.ref } : {}),
    ...(destructive ? { destructive: true } : {}),
  });

  if (decision === "allow") return { proceed: true };

  // Skipped, return a graceful tool result so the model can move on or explain.
  return {
    proceed: false,
    result: {
      approved: false,
      message: `The user declined to ${summary}. Do not retry it, acknowledge their choice and offer an alternative if helpful.`,
    },
  };
}

// Run a tool by name, defending against an unknown name and a malformed arguments
// string, so one bad call never throws the whole loop. Action tools first pass
// through the approval gate above, a skipped action returns a graceful result and
// the tool's execute never runs. The result is always a JSON-serializable value
// the loop can stringify into a tool message.
async function runToolCall(
  call: ToolCall,
  toolMap: Map<string, AiTool>,
  deps: GateDeps,
): Promise<unknown> {
  const tool = toolMap.get(call.function.name);
  if (!tool) {
    return { error: `Unknown tool "${call.function.name}".` };
  }
  const args = parseToolArgs(call);
  if (args === null) {
    return { error: "Tool arguments were not valid JSON." };
  }

  // propose_plan is the plan-approval coordination tool, the loop owns it. It is
  // NOT an action and must not flow through the per-action gate (that would
  // double-confirm), so handle it by name before the gate and never call its
  // execute. On Approve it flips the run-level plan flag.
  if (call.function.name === PROPOSE_PLAN_TOOL_NAME) {
    return handleProposePlan(args, deps);
  }

  // ask_user is the structured-choice coordination tool, the loop owns it too. It
  // is NOT an action and must not flow through the per-action gate (there is
  // nothing to approve, the user is picking). Handle it by name before the gate,
  // it raises a "choice" request on the shared bridge and returns the selection.
  if (call.function.name === ASK_USER_TOOL_NAME) {
    return handleAskUser(args, deps);
  }

  // Approval gate for action tools. Read-only tools pass straight through.
  const gate = await gateToolCall(tool, args, deps);
  if (!gate.proceed) return gate.result;

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

  // Build the gate deps once. Review mode defaults to "step" (the safe, most
  // transparent mode) when the caller did not inject a reader. The approval
  // request is wrapped so the panel sees an "awaiting-approval" status while the
  // loop is paused on the user. The plan-approval flag is fresh per run and
  // starts false, so an approval never leaks across separate user messages.
  const gateDeps: GateDeps = {
    getReviewMode: options.getReviewMode ?? (() => "step"),
    requestApproval: options.requestApproval
      ? async (request) => {
          options.onStatus?.({
            phase: "awaiting-approval",
            toolName: request.toolName,
          });
          return options.requestApproval!(request);
        }
      : undefined,
    planState: { approved: false },
  };

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
      const result = await runToolCall(call, toolMap, gateDeps);
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
