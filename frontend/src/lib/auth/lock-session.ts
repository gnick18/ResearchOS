// Lock the app session (seamless-reconnect, 2026-06-20).
//
// Grant's Lock vs Sign-out split (locked decision). "Lock" is like locking a
// screen rather than logging out: it ends the current in-app session but KEEPS
// the stored folder handle AND the cloud account session on this device, so the
// next entry is the one-click / silent unlock (the Phase 1 reconnect under the
// splash), NOT a re-pick of the folder or a fresh sign-in. "Sign out" (fullSignOut)
// is the FULL logout that ALSO forgets the folder on this device, the shared-
// computer-safe default.
//
// What Lock does and does NOT do:
//   - KEEPS the stored folder handle (does NOT call disconnect / clearDirectoryHandle).
//     On re-entry, resolveReconnectIntent finds the handle and reconnects silently
//     (grant still granted) or with one Allow click (grant lapsed).
//   - KEEPS the cloud (NextAuth) session. Lock is not a logout.
//   - Clears the in-memory unlocked sharing identity so the app surface is left in a
//     locked state for this load. The device vault still holds the key, so
//     IdentitySessionRestorer re-populates it transparently on the next boot once the
//     folder + user are back (no recovery-code prompt in the common case), which is
//     exactly the "one-click unlock" the mockup shows.
//   - Hard-navigates to "/" so the module-scoped entry-action state in providers.tsx
//     resets and the reconnect / splash flow runs cleanly from the front door.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { clearSessionIdentity } from "../sharing/identity/session-key";

export function lockApp(): void {
  // End the in-memory unlocked identity. The persisted key (device vault) and the
  // stored folder handle are untouched, so the next load reconnects + re-unlocks
  // seamlessly rather than forgetting anything.
  try {
    clearSessionIdentity();
  } catch {
    // Never block the lock on a session-clear hiccup; the hard nav below still
    // resets the app to the reconnect flow.
  }

  // Hard navigation to the front door. A full document load resets providers.tsx
  // module state, so the boot reconnect (silent or one-click) runs from a clean
  // entry. The handle and cloud session remain, so this lands back in the folder.
  if (typeof window !== "undefined") {
    window.location.assign("/");
  }
}
