// OAuth-first login redesign flag (entry-flow redesign, 2026-06-11).
//
// The redesign replaces the StartScreen / EntrySnapSurface start-chooser with a
// single light "marketing-deck intro" landing, makes the provider buttons sign
// in IMMEDIATELY (the provider opens before any folder picker), and moves the
// folder step to AFTER the provider returns. It also adds a dedicated "Welcome
// back" re-login screen with the last-used provider floated to the top.
//
// Gated on NEXT_PUBLIC_OAUTH_FIRST_LOGIN so the check runs client-side and bakes
// at build. Default OFF. When OFF the existing entry flow (EntrySnapSurface ->
// AccountTierChooser -> FolderConnectGate -> ProviderSignInRedirect ->
// UserLoginScreen) is byte-for-byte unchanged. The deployer flips it to "true"
// once the redesign is verified live.
//
// No em-dashes, no emojis, no mid-sentence colons.

export function isOAuthFirstLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OAUTH_FIRST_LOGIN === "true";
}

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
