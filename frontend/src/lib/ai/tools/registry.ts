// BeakerBot tool registry (ai tools bot, 2026-06-10).
//
// The single list of tools BeakerBot can call, plus a name-keyed lookup the agent
// loop dispatches through. Adding the next tool later (a wiki search, a write tool
// gated by approval) is one import and one array entry, no loop change. That is the
// extensibility the design asks for.
//
// The registry holds READ-ONLY tools, read-only with respect to the user's DATA.
// Alongside the data readers it now holds the navigate-and-spotlight pair, which
// changes the VIEW (navigation plus a decorative highlight) but never the user's
// files, so it stays in the read-only set with no approval gate. There is still no
// write tool and no coworker-mode tool. Those are later slices.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { getMyProjectsTool, getMyTasksTool } from "./read-my-work";
import { findUiElementTool } from "./find-ui-element";
import { spotlightUiElementTool } from "./spotlight-ui-element";
import type { AiTool } from "./types";

// The default toolset handed to the agent loop. All read-only for user data.
export const READ_ONLY_TOOLS: AiTool[] = [
  getMyTasksTool,
  getMyProjectsTool,
  findUiElementTool,
  spotlightUiElementTool,
];

/** Build a name -> tool lookup for dispatch. The loop calls this once per run and
 *  resolves each model-requested tool_call by name. */
export function buildToolMap(tools: AiTool[]): Map<string, AiTool> {
  const map = new Map<string, AiTool>();
  for (const tool of tools) map.set(tool.name, tool);
  return map;
}
