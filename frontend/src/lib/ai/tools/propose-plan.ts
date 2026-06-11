// BeakerBot propose_plan tool (ai plan bot, 2026-06-11).
//
// The proposal step of the plan-first action flow. When the user asks BeakerBot
// to DO something, BeakerBot reasons out the whole sequence of routine steps and
// calls propose_plan with them in plain words, for example ["Go to the Methods
// page", "Click the New Method button"]. The agent loop shows that plan to the
// user with a single Approve / Cancel, and on Approve sets a run-level flag so
// the subsequent action tools (go_to_page, read_page, click_element) run in order
// WITHOUT asking again. On Cancel the loop tells the model to stop and acknowledge.
//
// Why a coordination tool, not an action tool. propose_plan does not change
// anything itself, it is the gate for the plan. It must NOT be routed through the
// per-action approval gate (it would double-confirm). So it carries no `action`
// flag, and the loop special-cases it by name through PROPOSE_PLAN_TOOL_NAME, the
// same way it owns the approval bridge. Keeping the recognition in one named
// constant means the loop and the registry agree on what "the plan tool" is
// without a magic string scattered around.
//
// The safety carve-out lives in the loop, not here. A genuinely destructive or
// outward-facing step (delete, send, share, pay, the destructive heuristic) STILL
// pops its own final confirm at the moment it runs, even inside an approved plan.
// Plan approval covers the routine steps only.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { AiTool } from "./types";

// The one name the loop recognizes as the plan-proposal tool, so the special
// handling and the registry never drift apart on a literal string.
export const PROPOSE_PLAN_TOOL_NAME = "propose_plan";

/** Pull the steps out of the model's parsed arguments, keeping only non-empty
 *  trimmed strings, so a malformed or empty step never reaches the UI. Pure, so
 *  the loop can reuse it to build the plan approval request. */
export function readPlanSteps(args: Record<string, unknown>): string[] {
  const raw = args.steps;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Pull the optional one-line summary, returning undefined when absent or blank. */
export function readPlanSummary(args: Record<string, unknown>): string | undefined {
  const raw = args.summary;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const proposePlanTool: AiTool = {
  name: PROPOSE_PLAN_TOOL_NAME,
  description:
    "Propose a plan to the user BEFORE you do anything for them. When the user asks you to DO something (open a form, create something, switch a tab, do it for me), do NOT navigate or click first. First call propose_plan with the whole sequence of steps you intend to take, each written as a short human sentence the user can read, for example \"Go to the Methods page\" then \"Click the New Method button\". You can name pages and controls from what you already know about the app, you do not need to navigate to write the plan. The app shows the user your plan with a single Approve or Cancel. If they approve, this returns approved true and you then carry out the steps in order with go_to_page, read_page, and click_element, WITHOUT asking again. If they cancel, this returns approved false, so stop and acknowledge their choice. Use this only when you are about to act. A pure how-to or where-is question does not need a plan, just guide the user with guide_to_element.",
  parameters: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: { type: "string" },
        description:
          'The ordered steps you intend to take, each a short human sentence, for example ["Go to the Methods page", "Click the New Method button"]. Describe the routine navigation and clicks, not internal tool names.',
      },
      summary: {
        type: "string",
        description:
          "Optional one-line summary of what the whole plan accomplishes, for example \"Open the new method form\".",
      },
    },
    required: ["steps"],
    additionalProperties: false,
  },
  // No `action` flag and no execute side effect. The loop owns this tool's
  // behavior (raising the plan approval and flipping the run-level flag) by name,
  // so execute is never actually called for it. It is defined for completeness
  // and as a fail-safe, if the loop ever dispatched it directly it would simply
  // report that no plan approval path was reached, never silently "approve".
  execute: async (args) => {
    const steps = readPlanSteps(args);
    return {
      approved: false,
      steps,
      message:
        "The plan was not presented for approval. Do not act, ask the user how they would like to proceed.",
    };
  },
};
