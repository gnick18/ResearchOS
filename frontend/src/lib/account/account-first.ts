// Cloud-accounts Phase 1: the account-first entry flag.
//
// When on, a signed-in user with no data folder lands on the folderless /account
// home instead of the folder-connect wall, and the front door treats an account
// (cloud, OAuth) and a data folder (local) as two separate, optional things.
//
// DEFAULT-ON (Phase 1 polish, 2026-06-13, browser-verified): this is now the real
// entry behavior. It only changes anything for a SIGNED-IN visitor with NO folder
// (existing folder-connected users never hit the gate, so their flow is
// unchanged). An env KILL SWITCH stays: set NEXT_PUBLIC_ACCOUNT_FIRST=0 (or
// "false") to fall back to the old folder-first flow. NEXT_PUBLIC so the check
// runs client-side in the entry state machine.
//
// No emojis, no em-dashes, no mid-sentence colons.

export function isAccountFirstEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ACCOUNT_FIRST;
  // On unless explicitly disabled.
  return v !== "0" && v !== "false";
}
