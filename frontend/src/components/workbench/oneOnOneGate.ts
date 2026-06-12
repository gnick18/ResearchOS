// Check-ins revamp Phase 1 (checkins-revamp bot, 2026-06-11). See
// docs/proposals/checkins-revamp.md (decision D1).
//
// Pure gating helper for the Workbench Check-ins tab. Decision D1: ALWAYS show
// the Check-ins tab for EVERY account, so starting your first space is always
// reachable. The empty state lives in the panel. The function + its arguments
// are kept (callers + the BeakerSearch source still pass them) so the signature
// stays stable, but it now returns true unconditionally.
//
// Kept I/O-free so the gate is unit-testable without the File System Access
// picker (which cannot be driven headlessly).

type ViewerAccountType = "solo" | "lab" | "lab_head" | "member" | null | undefined;

/**
 * Whether the Check-ins Workbench tab should be visible. Always true (D1).
 * @param accountType the viewer's account type (from `useAccountType`).
 * @param oneOnOneCount how many spaces the viewer participates in.
 */
export function shouldShowOneOnOneTab(
  _accountType: ViewerAccountType,
  _oneOnOneCount: number,
): boolean {
  return true;
}
