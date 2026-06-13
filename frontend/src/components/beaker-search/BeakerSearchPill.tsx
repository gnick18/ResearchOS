"use client";

// sequence editor master. BeakerSearch step 2a, the shared front-door PILL.
//
// A visible, search-bar-styled pill that opens the Cmd-K command palette, so the
// palette is discoverable without knowing the shortcut. Extracted from the
// sequences toolbar pill (SequenceEditView) so the SAME front door can sit in
// the app chrome on every page. The mark is the real BeakerBot mascot (component
// import, no inline svg). Wrapped in <Tooltip> (native title= is invisible here).
//
// The sequences-toolbar pill stays as-is (it already calls openPalette); this is
// the app-wide instance mounted in AppShell. A minor redundancy on the Sequences
// page (two doorways) is fine.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useEffect, useState } from "react";

import BeakerBot from "@/components/BeakerBot";
import Tooltip from "@/components/Tooltip";
import { useBeakerSearch } from "./BeakerSearchProvider";
import { isRecordingMode } from "@/lib/file-system/wiki-capture-mock";

/** The app-chrome front door for BeakerSearch. Opens the shared palette. */
export default function BeakerSearchPill() {
  const { openPalette } = useBeakerSearch();
  // Hidden in marketing-video record mode (?record=1) so demo clips feature the
  // new bottom-center BeakerSearch bar, not this legacy top-nav pill. Read
  // client-only after mount to stay hydration-safe. (This pill is slated for
  // removal once the nav-slimming migration lands; see the AppShell TODO.)
  const [hideForRecording, setHideForRecording] = useState(false);
  useEffect(() => setHideForRecording(isRecordingMode()), []);
  if (hideForRecording) return null;
  return (
    <Tooltip label="Search every tool (Cmd K)" placement="bottom">
      <button
        type="button"
        onClick={() => openPalette()}
        data-testid="beakersearch-pill"
        // Closing the palette must NOT programmatically refocus this pill, or
        // its hover tooltip + focus ring pop unbidden after an Escape close (the
        // pointer is elsewhere). The palette honors this opt-out; the pill is
        // persistent, self-labeled chrome, so focus falling to the body is fine.
        data-palette-no-refocus=""
        aria-label="Open BeakerSearch (Cmd K)"
        // Closing the palette restores focus here (correct a11y), so the
        // resting focus state must look intentional. The default browser
        // outline rendered as a stray "halo" against the header; use the app's
        // focus-visible ring instead (shown for keyboard focus, hidden for
        // mouse).
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-2.5 py-1 text-foreground-muted transition-colors hover:border-sky-300 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:hover:border-sky-700"
      >
        <BeakerBot
          pose="idle"
          animated={false}
          className="h-5 w-5"
          ariaLabel="BeakerBot"
        />
        <span className="hidden text-meta font-medium sm:inline">
          BeakerSearch
        </span>
        <kbd className="hidden rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-foreground-muted sm:inline">
          Cmd K
        </kbd>
      </button>
    </Tooltip>
  );
}
