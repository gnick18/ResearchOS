"use client";

// Top-bar folder control (multi-folder picker).
//
// ResearchOS already keeps each connected folder as a FULLY separate data store
// (a research lab, a classroom, a solo folder). This component is PURELY the
// switcher UX on top of that. It renders the existing FolderSwitcher dropdown as
// the header folder control. The pill shows the active folder name and, when
// clicked, drops down a menu of ALL the user's remembered folders to switch
// between, with an "Add folder" row at the bottom that opens the connect /
// add-folder flow. It does NOT touch the data model or the separation.
//
// Behavior:
//   - The pill always renders (the `always` prop on FolderSwitcher keeps it
//     visible even with a single folder), so the dropdown + Add-folder row are
//     permanently reachable from the header.
//   - The dropdown lists every remembered folder (one click switches), surfaces
//     lab discovery, and ends with the Add-folder action. FolderSwitcher owns
//     all of that, so it is not reimplemented here.
//
// Hard-gated by NEXT_PUBLIC_MULTI_FOLDER (via MULTI_FOLDER_ENABLED): when the
// flag is off this renders nothing and the header is byte-identical to today.
// The "Class / My work" view-lens toggle (PiViewModeToggle) is a DIFFERENT
// control (a within-folder view lens) and lives elsewhere in the bar untouched.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import FolderSwitcher from "./FolderSwitcher";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";

export default function TopBarFolderChips({
  /** Header tint state (passed from AppShell). Forwarded to the FolderSwitcher
   *  so the pill matches the neighboring header controls when the header is
   *  colored (lab branding). */
  tinted = false,
}: {
  tinted?: boolean;
}) {
  if (!MULTI_FOLDER_ENABLED) return null;
  return <FolderSwitcher variant="header" always tinted={tinted} />;
}
