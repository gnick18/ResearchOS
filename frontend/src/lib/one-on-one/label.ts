// 1:1 revamp (oneonone data+strip bot, 2026-06-07). See
// docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md (Locked decisions, round 2).
//
// The 1:1 label is ROLE-RELATIVE: it names the COUNTERPART and frames the
// relationship from who is looking. A lab head sees the "Mentoring" framing
// labeled by the member; a member sees the "Check-ins" framing labeled by the
// lab head. There is no fixed "1:1s" label.
//
// These are PURE helpers (no I/O), so the UI derives the label from the viewer
// + the record alone.

import type { OneOnOne } from "../types";

type ViewerAccountType = "solo" | "lab" | "lab_head";

/**
 * The per-1:1 entry label, derived from who is looking.
 * - Lab head: "<member> - Mentoring".
 * - Member (or anyone who is not the lab head): "<labHead> - Check-ins".
 *
 * Identity is by username (not account_type), so a lab head viewing their own
 * 1:1 always gets the Mentoring framing and the member always gets Check-ins.
 */
export function oneOnOneLabel(viewer: string, oneOnOne: OneOnOne): string {
  if (viewer === oneOnOne.labHead) {
    return `${oneOnOne.member} - Mentoring`;
  }
  return `${oneOnOne.labHead} - Check-ins`;
}

/**
 * The Workbench tab label for a viewer, by their account type.
 * - Lab head: "Mentoring".
 * - Everyone else: "Check-ins".
 */
export function oneOnOneTabLabel(viewerAccountType: ViewerAccountType): string {
  return viewerAccountType === "lab_head" ? "Mentoring" : "Check-ins";
}
