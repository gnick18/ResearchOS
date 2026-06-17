// Require-account entry flag (require-account-local-first pivot, 2026-06-16).
//
// When on, the no-account local-only entry paths are closed so every new entry
// goes through sign-in first. Data still stays local-first and E2E after the
// sign-in (the account is identity, not storage, and the app keeps working
// offline once a folder is connected). DEFAULT OFF, so this ships dark and flips
// in one move once verified.
//
// A defensive fallback in the entry surfaces keeps a local path open whenever no
// account tier is actually available (for example a build with OAuth turned off),
// so flipping this flag can never hard-trap a visitor with no way forward. See
// the no-soft-locks rule.
//
// NEXT_PUBLIC so the client-side entry state machine can read it.
//
// No emojis, no em-dashes, no mid-sentence colons.

export function isRequireAccountEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
  return v === "1" || v === "true";
}

/**
 * Whether a no-account local path should still be offered in an entry surface.
 *
 * The require-account flag retires the local path, EXCEPT as a fallback when no
 * account tier is actually available in this build (hasAccountTier false), since
 * hiding the only remaining way forward would hard-trap the visitor. This single
 * helper encodes the no-soft-locks invariant for every entry surface (the tier
 * chooser's Local tile and the welcome-back screen's "Open a folder" escape), so
 * the rule lives and is tested in exactly one place.
 */
export function isLocalPathVisible(opts: {
  requireAccount: boolean;
  hasAccountTier: boolean;
}): boolean {
  return !opts.requireAccount || !opts.hasAccountTier;
}
