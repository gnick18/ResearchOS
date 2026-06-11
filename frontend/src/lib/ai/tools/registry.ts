// BeakerBot tool registry (ai tools bot, 2026-06-10).
//
// The single list of tools BeakerBot can call, plus a name-keyed lookup the agent
// loop dispatches through. Adding the next tool later (a wiki search, a write tool
// gated by approval) is one import and one array entry, no loop change. That is the
// extensibility the design asks for.
//
// The registry holds the read-only tools plus the first ACTION tool. The read-only
// set is read-only with respect to the user's DATA. Alongside the data readers it
// holds the live page-perception trio, read_page (perceive the current page),
// go_to_page (navigate when the target is elsewhere), and guide_to_element (scroll
// to and spotlight a perceived element). Those change the VIEW (a route and a
// decorative highlight) but never the user's files, so they stay in the read-only
// set with no approval gate.
//
// The first action tool is click_element, which dispatches a real click for the
// user. It carries action: true, so the agent loop routes it through the approval
// gate (propose-then-approve in "ask" autonomy, direct in "auto", with a
// destructive hard-stop in both). Future write tools (note writing, run_analysis)
// reuse the SAME flag and gate, one import and one array entry, no loop change.
//
// The old manifest-driven find_ui_element / spotlight_ui_element pair is retired,
// live perception supersedes a hand-built element catalog. The manifest's one
// surviving job, knowing which PAGE a feature lives on, lives in page-routing.ts and
// is used by go_to_page.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { getMyProjectsTool, getMyTasksTool } from "./read-my-work";
import { readPageTool } from "./read-page";
import { goToPageTool } from "./go-to-page";
import { guideToElementTool } from "./guide-to-element";
import { clickElementTool } from "./click-element";
import { proposePlanTool } from "./propose-plan";
import { askUserTool } from "./ask-user";
import {
  listDataHubTablesTool,
  runDataHubAnalysisTool,
} from "./datahub-analysis";
import type { AiTool } from "./types";

// The read-only toolset, read-only with respect to the user's data. Exported on
// its own so a future cautious "question only" mode can hand the model just these
// and nothing that acts (design doc section 4, the capability wall).
export const READ_ONLY_TOOLS: AiTool[] = [
  getMyTasksTool,
  getMyProjectsTool,
  readPageTool,
  goToPageTool,
  guideToElementTool,
  listDataHubTablesTool,
];

// The action toolset. Each tool here carries action: true and goes through the
// agent loop's approval gate. click_element dispatches a real click;
// run_datahub_analysis runs a Data Hub statistical analysis and stores the
// version-controlled result (non-destructive, so plan-approval covers it).
export const ACTION_TOOLS: AiTool[] = [
  clickElementTool,
  runDataHubAnalysisTool,
];

// The coordination toolset. These tools neither read the user's data nor act on
// it, they steer the user-input flow itself, and the loop recognizes each by name
// and raises a request on the shared pause/resume bridge. None carries an `action`
// flag, they must not flow through the per-action gate.
//   - propose_plan is the proposal step of the plan-first action flow, it raises
//     a single Approve / Cancel for the whole plan, then lets the routine action
//     tools run without re-asking.
//   - ask_user is the structured-choice primitive, it raises a "choice" request so
//     the user TAPS a button to pick from a known small set instead of typing the
//     answer back, and returns the selection to the model.
export const COORDINATION_TOOLS: AiTool[] = [proposePlanTool, askUserTool];

// The default toolset handed to the agent loop, the read-only tools plus the
// coordination tools plus the action tools. The loop reads each tool's `action`
// flag (and special-cases propose_plan by name) to decide how to handle each, so
// mixing them in one list is safe.
export const DEFAULT_TOOLS: AiTool[] = [
  ...READ_ONLY_TOOLS,
  ...COORDINATION_TOOLS,
  ...ACTION_TOOLS,
];

/** Build a name -> tool lookup for dispatch. The loop calls this once per run and
 *  resolves each model-requested tool_call by name. */
export function buildToolMap(tools: AiTool[]): Map<string, AiTool> {
  const map = new Map<string, AiTool>();
  for (const tool of tools) map.set(tool.name, tool);
  return map;
}
