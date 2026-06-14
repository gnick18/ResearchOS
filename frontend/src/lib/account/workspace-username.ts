// Account-first onboarding (2026-06-14): derive a folder-local workspace
// username from a signed-in cloud account.
//
// When a signed-in account connects a fresh, EMPTY folder we auto-provision the
// first workspace user from the account profile instead of dropping the user on
// the "create a user" screen (redundant friction: the account already has a
// name, an @handle, and an email). See UserLoginScreen's auto-provision path.
//
// The username is the human display identity shown EVERYWHERE in the app
// (greetings render it verbatim, avatars take its first letter), so we prefer
// the most person-like source: the claimed profile DISPLAY NAME (e.g. "Fake
// PI"), then the OAuth session name, then the @handle, and only as a last resort
// the email local-part (e.g. "gnick") which reads like a login id, not a person.
//
// The username ALSO becomes a folder name (users/<username>/...), so we strip
// path-hostile characters while preserving spaces and capitalization, so the
// greeting reads naturally ("Welcome back, Fake PI").
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export interface AccountNameParts {
  /** The claimed account profile display name (from /api/account/profile). */
  displayName?: string | null;
  /** The OAuth session name (from /api/auth/session). */
  sessionName?: string | null;
  /** The claimed @handle (from /api/account/profile). */
  handle?: string | null;
  /** The verified session email; only the local-part is ever used. */
  email?: string | null;
}

// Folder names stay readable but bounded so a pasted-in name cannot produce a
// pathological directory entry.
const MAX_LENGTH = 40;

/**
 * Keep letters, digits, spaces, underscores, and hyphens; replace every other
 * run (path separators, punctuation, control chars) with a single space; then
 * collapse whitespace, trim, and cap the length. Spaces and capitalization are
 * preserved so the greeting reads as a real name.
 */
function sanitize(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH)
    .trim();
}

/** The portion of an email before the "@", trimmed. */
function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return (at === -1 ? email : email.slice(0, at)).trim();
}

/**
 * Best human-readable, path-safe workspace username for the account, or null
 * when no usable source exists (every candidate empty or all-invalid chars),
 * in which case the caller should fall back to the manual create-user screen.
 */
export function deriveWorkspaceUsername(parts: AccountNameParts): string | null {
  const candidates: Array<string | null | undefined> = [
    parts.displayName,
    parts.sessionName,
    parts.handle,
    parts.email ? emailLocalPart(parts.email) : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const cleaned = sanitize(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}
