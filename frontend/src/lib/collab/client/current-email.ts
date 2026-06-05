// Phase 3c: the current device user's directory email, for signing collab
// requests.
//
// Collab Neon calls (open / push / grant) must be signed with the CALLER's
// canonical directory email, the address their sharing identity was bound under.
// That email lives in the per-user _sharing_identity.json sidecar and is exposed
// in React via useSharingIdentity().email. But the collab client (persistence,
// sync-hooks, store) is plain TypeScript that runs outside React and resolves
// the email lazily at sign time (so a request never goes out with a username, a
// note-owner, or a not-yet-loaded null).
//
// The React layer pushes the resolved email here whenever the sharing identity
// loads or changes; the collab client reads it when it actually signs. Resolving
// per-call (not per-open) also dodges the race where a note opens before the
// identity sidecar finishes loading: the open-time adopt may skip, but the next
// push picks up the email once it is set.

let _currentCollabEmail: string | null = null;

/**
 * Set the current device user's canonical directory email (or null when no
 * sharing identity is set up on this device). Called by the React layer from a
 * useSharingIdentity effect.
 */
export function setCollabSignerEmail(email: string | null): void {
  _currentCollabEmail = email && email.includes("@") ? email : null;
}

/**
 * The current device user's canonical directory email, or null when this device
 * has no sharing identity. The collab client signs with this; a null means the
 * durable Neon layer stays dark (live collab over the relay still works).
 */
export function getCollabSignerEmail(): string | null {
  return _currentCollabEmail;
}
