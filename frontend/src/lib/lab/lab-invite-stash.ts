// Lab tier Phase 8e: persist a pending invite across onboarding.
//
// A brand-new user who opens an invite link has no folder/identity yet, so they
// cannot accept immediately. We stash the invite fragment in localStorage so it
// survives the folder-connect + identity-create + OAuth round-trips, then the
// app-wide LabInviteResume banner brings them back to /lab/join to accept.
//
// We store the raw URL hash fragment (base64url payload), not a parsed object,
// so the consumer decodes + re-validates it exactly as if it came from the URL.
//
// No emojis, no em-dashes, no mid-sentence colons.

const KEY = "ros:pendingLabInvite";

export function stashInviteFragment(fragment: string): void {
  try {
    if (fragment) localStorage.setItem(KEY, fragment);
  } catch {
    // localStorage can throw in private mode / disabled storage; the invite
    // simply will not persist across onboarding, which is acceptable.
  }
}

export function readStashedInviteFragment(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearStashedInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
