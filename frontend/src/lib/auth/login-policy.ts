// Identity model simplification, phase 1, the login-required policy.
//
// Decides when a per-user login is mandatory. A genuinely solo folder (one user,
// no lab head) keeps the optional-password behavior it has always had. The moment
// a folder is shared (two or more users) OR a lab head is present, every account
// in it must have a login before it can sign in. Evaluating this at login time is
// what makes the "prompt each user on next open" and "auto-prompt when a folder
// gains a second user" decisions fall out for free, the gate simply re-checks the
// current folder state every time.
//
// Pure, no I/O. The caller supplies the folder's user count and whether any lab
// head is present (read from the user settings). See
// docs/proposals/IDENTITY_MODEL_SIMPLIFICATION.md.

/**
 * Whether a folder requires every account in it to have a login.
 *
 * @param userCount  how many users live in this folder
 * @param anyLabHead whether any account in the folder is a lab head (PI)
 */
export function folderRequiresLogin(
  userCount: number,
  anyLabHead: boolean,
): boolean {
  return userCount >= 2 || anyLabHead;
}
