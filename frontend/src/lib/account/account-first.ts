// Cloud-accounts Phase 1 (Chunk C): the account-first entry flag.
//
// When on, a signed-in user with no data folder lands on the folderless /account
// home instead of the folder-connect wall, and the front door treats an account
// (cloud, OAuth) and a data folder (local) as two separate, optional things. Off
// by default (NEXT_PUBLIC_ACCOUNT_FIRST unset) so the current folder-first flow is
// completely unchanged until this is dogfooded and the default flips. NEXT_PUBLIC
// so the check runs client-side in the entry state machine.
//
// No emojis, no em-dashes, no mid-sentence colons.

export function isAccountFirstEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_ACCOUNT_FIRST === "1" ||
    process.env.NEXT_PUBLIC_ACCOUNT_FIRST === "true"
  );
}
