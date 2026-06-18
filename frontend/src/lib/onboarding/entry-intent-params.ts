// Entry-intent URL params (connect-gate Back fix, 2026-06-18).
//
// The folder-connect gate renders whenever no folder is attached, AFTER the
// entry-flow branches (the OAuth-first front door, the sign-in screen). Those
// branches are skipped while a provider intent still sits in the URL:
//   - ?sharingClaim  drives sharingClaimReturn
//   - ?signIn        drives signInInFlight (pendingSignInProvider)
// So the gate's "Back" cannot reveal the front door until BOTH are cleared.
// Stripping only one left the other class of arrival pinned on the gate, which
// read to the user as "Back does nothing".
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** Query params that, while present, keep the entry-flow front door skipped. */
export const ENTRY_INTENT_PARAMS = ["sharingClaim", "signIn"] as const;

/**
 * Strip every entry-intent param from a URL's query string. Returns the new
 * query string (without the leading "?", may be empty) when at least one param
 * was removed, or null when there was nothing to strip. Pure, so the call site
 * stays a thin history.replaceState wrapper and the logic is unit-testable.
 *
 * @param search the location.search value, with or without a leading "?".
 */
export function stripEntryIntentParams(search: string): string | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  let changed = false;
  for (const param of ENTRY_INTENT_PARAMS) {
    if (params.has(param)) {
      params.delete(param);
      changed = true;
    }
  }
  if (!changed) return null;
  return params.toString();
}
