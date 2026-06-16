// Last-used sign-in provider memory (entry-flow redesign, 2026-06-11).
//
// The OAuth-first entry flow (the single marketing-deck landing, provider
// buttons that sign in immediately, folder step after the return, and the
// "Welcome back" re-login screen) is now the only entry path, so the old
// NEXT_PUBLIC_OAUTH_FIRST_LOGIN rollout flag and its legacy EntrySnapSurface
// fallback were removed (2026-06-16). What remains here is the small browser
// memory of the provider you last used, read by "Welcome back" to float it up.
//
// No em-dashes, no emojis, no mid-sentence colons.

// localStorage key recording the provider the visitor most recently signed in
// with. Written on every signIn() kicked off by the new flow, read by the
// "Welcome back" re-login screen to float that provider to the top with a "Last
// used" badge. Browser-local (not in the research folder), purely a convenience
// signal, so a missing or stale value just means no provider is pre-floated.
export const LAST_PROVIDER_KEY = "researchos:last-provider";

/** Record the provider just used to sign in. Best-effort; private-mode
 *  failures are swallowed (the badge is a nicety, never load-bearing). */
export function rememberLastProvider(provider: string): void {
  try {
    localStorage.setItem(LAST_PROVIDER_KEY, provider);
  } catch {
    // localStorage unavailable (private mode); the badge just will not show.
  }
}

/** Read the last provider used, or null if none is recorded / unreadable. */
export function readLastProvider(): string | null {
  try {
    return localStorage.getItem(LAST_PROVIDER_KEY);
  } catch {
    return null;
  }
}
