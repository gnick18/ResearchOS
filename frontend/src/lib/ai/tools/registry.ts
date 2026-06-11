// BeakerBot tool registry (ai tools bot, 2026-06-10).
//
// The single list of tools BeakerBot can call, plus a name-keyed lookup the agent
// loop dispatches through. Adding the next tool later (a wiki search, a write tool
// gated by approval) is one import and one array entry, no loop change. That is the
// extensibility the design asks for.
//
// The registry holds READ-ONLY tools, read-only with respect to the user's DATA.
// Alongside the data readers it holds the live page-perception trio, read_page
// (perceive the current page), go_to_page (navigate when the target is elsewhere),
// and guide_to_element (scroll to and spotlight a perceived element). Those change
// the VIEW (a route and a decorative highlight) but never the user's files, so they
// stay in the read-only set with no approval gate. There is still no write tool and
// no coworker-mode tool. Those are later slices.
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
import type { AiTool } from "./types";

// The default toolset handed to the agent loop. All read-only for user data.
export const READ_ONLY_TOOLS: AiTool[] = [
  getMyTasksTool,
  getMyProjectsTool,
  readPageTool,
  goToPageTool,
  guideToElementTool,
];

/** Build a name -> tool lookup for dispatch. The loop calls this once per run and
 *  resolves each model-requested tool_call by name. */
export function buildToolMap(tools: AiTool[]): Map<string, AiTool> {
  const map = new Map<string, AiTool>();
  for (const tool of tools) map.set(tool.name, tool);
  return map;
}
