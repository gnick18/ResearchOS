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
import { useHasPiPowers } from "@/hooks/useIsLabManager";
import { useIsClassMode } from "@/hooks/useIsClassMode";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export default function LabHeadCopilotMount() {
  const { currentUser } = useFileSystem();

  // Class Mode (CM-P2B, addendum H2): a class instructor is a lab_head by role,
  // so this research PI copilot (grant / RPPR / inventory framed) would mount
  // for them and offer the wrong toolset. Suppress the research PI tool suite
  // + the ask-bar door when the active folder is a class. A class-specific tool
  // subset is a later stage; this stage only withholds the research tools so
  // they are never offered in a classroom. The general BeakerBot (the global
  // BeakerSearchProvider + palette) is untouched and stays available.
  //
  // useIsClassMode returns `undefined` while the read is in flight; we collapse
  // that to "not a class" so the existing research mount is unchanged until the
  // read settles (and is byte-identical everywhere with class mode off, since
  // no folder carries lab_kind === "class" then).
  const isClassMode = useIsClassMode(currentUser ?? null) === true;

  // The PI copilot is a delegated power (Lab Manager Phase 1): the lab head OR a
  // Lab Manager mounts it. Strict === true so the loading (undefined) state does
  // not mount it prematurely.
  const isLabHead = useHasPiPowers(currentUser ?? null) === true;
  const shouldMount = AI_ASSISTANT_ENABLED && isLabHead && !isClassMode;

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
