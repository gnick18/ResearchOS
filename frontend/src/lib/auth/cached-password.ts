// SENSITIVE: this module holds the user's account password in memory so
// the encrypted-backup decrypt path can run without re-prompting on every
// poll. See SECURITY_AUDIT.md §1.6 + the security-manager review of the
// encrypted-backup chip (constraints 1 + 2).
//
// THE PASSWORD MUST NEVER PERSIST TO:
//   - localStorage / sessionStorage / cookies
//   - IndexedDB / File System Access disk
//   - React state, Zustand, React Query cache
//   - any other surface that survives a tab close or hides outside this
//     module's closure
//
// Same-origin JS can read this variable — that is acceptable per the
// threat model (we trust same-origin code). What is NOT acceptable is any
// persistent surface, because the encrypted-backup feature must be safe
// for a stolen laptop / cloud-folder-leak scenario where the attacker has
// the encrypted blob but cannot replay an in-memory password from days
// ago.
//
// Wipe triggers (constraint 2 — must ALL be wired):
//   (a) Tab visibility hidden for >15 min (idle timeout).
//   (b) Explicit logout / user-switch.
//   (c) Folder switch (FileSystemProvider.disconnect).
//   (d) Explicit "Lock encrypted backup access" button in Settings.
//   (e) Any auth-failure decrypt event (wrong-password attempt).
//
// Each wipe-trigger site calls `clearCachedPassword()` directly. Do NOT
// extend the lifetime of the cache or add new code paths that copy the
// password elsewhere; future code that needs it must call
// `getCachedPassword()` at the moment of need and not stash a copy.

let cachedPassword: string | null = null;

export function setCachedPassword(password: string): void {
  cachedPassword = password;
}

export function getCachedPassword(): string | null {
  return cachedPassword;
}

export function clearCachedPassword(): void {
  cachedPassword = null;
}

export function hasCachedPassword(): boolean {
  return cachedPassword !== null;
}
