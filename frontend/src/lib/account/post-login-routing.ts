// Post-login destination by account type (require-account pivot, 2026-06-16).
//
// After login, route people to their home instead of a generic hub. The only
// account types resolvable BEFORE a folder is connected are the org admins
// (department and institution), because their status lives in a server record
// keyed to the OAuth email, not in the per-folder settings file. Lab-head status
// lives in the in-folder settings, so a lab head is routed to their lab only
// after the folder is connected (handled in the app shell, not here).
//
// This resolver is pure so the priority order and the flag gating are tested in
// one place. The async org-admin lookups happen in AccountFirstRedirect, which
// is fail-safe (a network error resolves to "not an admin"), so a transient
// failure simply falls through to the account hub. No soft-locks.
//
// No emojis, no em-dashes, no mid-sentence colons.

export interface PostLoginRoutingInput {
  /** Whether the signed-in account administers a department (server-resolved). */
  isDeptAdmin: boolean;
  /** Whether the signed-in account administers an institution (server-resolved). */
  isInstitutionAdmin: boolean;
  /** The department portal flag, so we never route to a disabled page. */
  deptEnabled: boolean;
  /** The institution portal flag, so we never route to a disabled page. */
  institutionEnabled: boolean;
  /** The route the visitor was trying to reach when bounced here, if any. */
  fromRoute: string | null;
}

/**
 * Resolves where a signed-in, folderless visitor should land.
 *
 * Priority: department admin first (the most specific home), then institution
 * admin, then the account hub. A department admin who also runs an institution
 * lands on their department, which is the tighter scope. The hub preserves the
 * bounced-from route so it can explain why a folder is needed. An admin route
 * ignores the from route, since the portal is folderless and is their home.
 */
export function resolvePostLoginDestination(input: PostLoginRoutingInput): string {
  if (input.deptEnabled && input.isDeptAdmin) return "/department";
  if (input.institutionEnabled && input.isInstitutionAdmin) return "/institution";
  const from = input.fromRoute;
  return from && from !== "/account"
    ? `/account?from=${encodeURIComponent(from)}`
    : "/account";
}
