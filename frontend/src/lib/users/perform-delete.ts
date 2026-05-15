/**
 * Extracted persistence layer for the "delete a user from the picker" flow.
 *
 * Lives outside the React component so its branching is unit-testable. The
 * component (UserLoginScreen.tsx) still owns UI state — picker list refresh,
 * confirmation dialog dismiss, error toasts. This module only owns the
 * dangerous part: making sure the FileSystemProvider's stored pointers
 * (`currentUser` and `mainUser` in IndexedDB) get cleared whenever the
 * deleted username matches them.
 *
 * The bug this exists to prevent: deleting the currently-active user via
 * the AppShell user-switch modal used to leave IndexedDB's `currentUser`
 * stale. providers.tsx would then re-render against the deleted username,
 * routing to "their home" with cached/empty React Query data instead of
 * dropping to the picker. Fixed at 7ac7a9ab; this module + its test pin
 * the fix so a future refactor can't silently regress it.
 */
export interface PerformUserDeleteDeps {
  /** The currently-active user per FileSystemProvider context. May be null. */
  currentUser: string | null;
  /** The persisted "main user" pointer. May be null. */
  mainUser: string | null;
  /** Two-step delete API. Step 1 is the warning, step 2 is the actual rm. */
  deleteUser: (
    username: string,
    confirmationStep: 1 | 2,
    acknowledgedWarning: boolean,
  ) => Promise<unknown>;
  /** Clears React state + IndexedDB stored currentUser when called with "". */
  setCurrentUser: (username: string) => Promise<void>;
  /** Persists the main-user pointer to IndexedDB. Called with "" to clear. */
  setMainUserPersisted: (username: string) => Promise<unknown>;
}

export async function performUserDelete(
  usernameToDelete: string,
  deps: PerformUserDeleteDeps,
): Promise<void> {
  await deps.deleteUser(usernameToDelete, 1, true);
  await deps.deleteUser(usernameToDelete, 2, true);

  if (deps.currentUser === usernameToDelete) {
    await deps.setCurrentUser("");
  }
  if (deps.mainUser === usernameToDelete) {
    await deps.setMainUserPersisted("");
  }
}
