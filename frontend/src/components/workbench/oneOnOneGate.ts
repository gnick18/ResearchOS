// 1:1 revamp (oneonone surface bot, 2026-06-07). See
// docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md (Locked decisions, round 2).
//
// Pure gating helper for the Workbench 1:1 tab. The tab is shown only when the
// viewer is a lab head (they can always set one up) OR the viewer already
// participates in at least one 1:1 (a member with an active 1:1). A solo user
// with no lab head and no 1:1s must NOT see an empty tab.
//
// Kept I/O-free so the gate is unit-testable without the File System Access
// picker (which cannot be driven headlessly).

type ViewerAccountType = "solo" | "lab" | "lab_head" | "member" | null | undefined;

/**
 * Whether the 1:1 ("Mentoring" / "Check-ins") Workbench tab should be visible.
 * @param accountType the viewer's account type (from `useAccountType`).
 * @param oneOnOneCount how many 1:1s the viewer participates in.
 */
export function shouldShowOneOnOneTab(
  accountType: ViewerAccountType,
  oneOnOneCount: number,
): boolean {
  if (accountType === "lab_head") return true;
  return oneOnOneCount > 0;
}
