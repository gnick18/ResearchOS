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

import BeakerBot from "@/components/BeakerBot";
import Tooltip from "@/components/Tooltip";
import { useBeakerSearch } from "./BeakerSearchProvider";

/** The app-chrome front door for BeakerSearch. Opens the shared palette. */
export default function BeakerSearchPill() {
  const { openPalette } = useBeakerSearch();
  return (
    <Tooltip label="Search every tool (Cmd K)" placement="bottom">
      <button
        type="button"
        onClick={() => openPalette()}
        data-testid="beakersearch-pill"
        aria-label="Open BeakerSearch (Cmd K)"
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-2.5 py-1 text-foreground-muted transition-colors hover:border-sky-300 hover:text-foreground dark:hover:border-sky-700"
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
