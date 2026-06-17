// The active BeakerBot tool scope.
//
// The conversation store is a singleton, so the tool set a turn runs with is a
// module-level scope rather than a per-conversation prop. A surface sets a scoped
// tool set when it mounts and clears it when it leaves, so BeakerBot offers the
// tools that fit WHERE the user is. The research shell uses the default set; the
// department portal sets the dept-scoped set (see DeptCopilotMount). Read fresh
// at the start of every turn, so navigation between surfaces swaps the tools.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { AiTool } from "./tools/types";
import { DEFAULT_TOOLS } from "./tools/registry";
import { BEAKERBOT_SYSTEM_PROMPT } from "./system-prompt";

let activeToolScope: AiTool[] | null = null;
let activePromptScope: string | null = null;

/** Set the active tool scope (null restores the default research-shell set). */
export function setToolScope(tools: AiTool[] | null): void {
  activeToolScope = tools;
}

/** The tools the next turn should run with. Defaults to DEFAULT_TOOLS. */
export function getActiveTools(): AiTool[] {
  return activeToolScope ?? DEFAULT_TOOLS;
}

/** Set the active system-prompt persona (null restores the research-shell one). */
export function setPromptScope(prompt: string | null): void {
  activePromptScope = prompt;
}

/** The system prompt a fresh conversation seeds with. Defaults to the research
 *  persona, so the dept portal can swap in its admin persona while mounted. */
export function getActiveSystemPrompt(): string {
  return activePromptScope ?? BEAKERBOT_SYSTEM_PROMPT;
}
