"use client";

/**
 * Mounts the lab-head BeakerBot on the /lab-overview surface (Phase 1 of the
 * PI copilot, see docs/proposals/2026-06-17-beakerbot-lab-head-utilities.md).
 *
 * The conversation infrastructure (BeakerSearchProvider + the palette) is
 * already global, so the only work here is two things: scope the tools to the
 * lab-head set while the surface is mounted, and render the always-present ask
 * bar as the visible door. Leaving the surface clears the scope, so BeakerBot
 * goes back to its research-shell tools elsewhere.
 *
 * Gate: only mounts when the current account is a lab head AND the AI assistant
 * flag is on. This mirrors how DeptCopilotMount is gated: the parent page
 * (/lab-overview/page.tsx) already redirects non-PIs away, but the mount adds
 * its own accountType guard so it is safe to include in any surface that
 * conditionally has a lab head.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */

import { useEffect } from "react";
import BeakerSearchBottomBar from "@/components/beaker-search/BeakerSearchBottomBar";
import { setToolScope, setPromptScope } from "@/lib/ai/tool-scope";
import {
  LAB_HEAD_SCOPE_TOOLS,
  LAB_HEAD_SYSTEM_PROMPT,
} from "@/lib/ai/tools/lab-head";
import { AI_ASSISTANT_ENABLED } from "@/lib/ai/config";
import { useAccountType } from "@/hooks/useAccountType";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export default function LabHeadCopilotMount() {
  const { currentUser } = useFileSystem();
  const accountType = useAccountType(currentUser ?? null);

  const isLabHead = accountType === "lab_head";
  const shouldMount = AI_ASSISTANT_ENABLED && isLabHead;

  useEffect(() => {
    if (!shouldMount) return;
    setToolScope(LAB_HEAD_SCOPE_TOOLS);
    setPromptScope(LAB_HEAD_SYSTEM_PROMPT);
    return () => {
      setToolScope(null);
      setPromptScope(null);
    };
  }, [shouldMount]);

  if (!shouldMount) return null;

  return <BeakerSearchBottomBar />;
}
