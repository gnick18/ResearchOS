// PI capability revamp (2026-06-07): the accidental-edit guard for role-based
// PI edits. A lab head may edit any member's record (canWrite grants it on the
// role alone, no password, no session). To prevent ACCIDENTAL edits, the first
// time a PI edits a given member's record in an app session we ask for one
// are-you-sure confirmation; after they confirm, that record stays freely
// editable for the rest of the session.
//
// "Session" = the lifetime of the loaded app. The store is in-memory, so a page
// reload clears it. A user switch must clear it explicitly (the active user
// changes, the previous PI's confirmations must not carry over), via
// `clearPiEditConfirmations()` wired to the same switch-user path the rest of
// the per-user caches use.
//
// This is a guard-rail, NOT an auth gate. canWrite already decided the PI MAY
// write; this only stops a stray keystroke from silently editing a member's
// record before the PI meant to.

/** Stable key for one record. Owner is included so the same numeric id under
 *  two different members never collides. */
export function piEditKey(
  targetOwner: string,
  recordType: "note" | "task" | "purchase",
  recordId: number | string,
): string {
  return `${targetOwner}::${recordType}::${recordId}`;
}

const confirmed = new Set<string>();

/** Whether this PI already confirmed editing this record this session. */
export function isPiEditConfirmed(key: string): boolean {
  return confirmed.has(key);
}

/** Remember that the PI confirmed editing this record for the session. */
export function markPiEditConfirmed(key: string): void {
  confirmed.add(key);
}

/** Wipe all confirmations. Called on user switch (and harmless on logout). */
export function clearPiEditConfirmations(): void {
  confirmed.clear();
}
