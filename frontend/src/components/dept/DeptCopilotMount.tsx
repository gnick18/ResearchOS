"use client";

/**
 * Mounts the department-head BeakerBot on the /department portal (Tier 1 of the
 * dept copilot, see docs/proposals/2026-06-17-beakerbot-department-copilot.md).
 *
 * The conversation infrastructure (BeakerSearchProvider + the palette) is already
 * global, so the only work here is two things: scope the tools to the
 * dept-admin set while the portal is mounted, and render the always-present ask
 * bar as the visible door. Leaving the portal clears the scope, so BeakerBot
 * goes back to its research-shell tools elsewhere.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */

import { useEffect } from "react";
import BeakerSearchBottomBar from "@/components/beaker-search/BeakerSearchBottomBar";
import { setToolScope, setPromptScope } from "@/lib/ai/tool-scope";
import { DEPT_SCOPE_TOOLS, DEPT_SYSTEM_PROMPT } from "@/lib/ai/tools/dept-admin";

export default function DeptCopilotMount() {
  useEffect(() => {
    setToolScope(DEPT_SCOPE_TOOLS);
    setPromptScope(DEPT_SYSTEM_PROMPT);
    return () => {
      setToolScope(null);
      setPromptScope(null);
    };
  }, []);

  return <BeakerSearchBottomBar />;
}
