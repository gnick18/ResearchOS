// In-memory holder for the unlocked device identity of the current session.
//
// Under the OAuth-only identity model (docs/proposals/IDENTITY_OAUTH_ONLY.md) the
// device keypair is wrapped at rest (see device-key.ts), so nothing usable sits
// on disk. The login ceremony (passkey, or recovery code offline) unwraps it ONCE
// per session and parks the result here; loadIdentity() then serves it for the
// rest of the session. Switching user, logging out, or closing the tab clears it.
//
// This module NEVER persists. It is a deliberate, process-memory-only seam so the
// at-rest store and the runtime key are separate concerns.

import type { StoredIdentity } from "./storage";

let current: StoredIdentity | null = null;
const subscribers = new Set<() => void>();

/** Park the unlocked identity for this session (or null to lock). */
export function setSessionIdentity(identity: StoredIdentity | null): void {
  current = identity;
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // a misbehaving subscriber must not break the unlock path
    }
  }
}

/** The unlocked identity for this session, or null when locked. */
export function getSessionIdentity(): StoredIdentity | null {
  return current;
}

/** Whether the session currently holds an unlocked key. */
export function isSessionUnlocked(): boolean {
  return current !== null;
}

/** Lock the session (switch user / logout / tab teardown). */
export function clearSessionIdentity(): void {
  setSessionIdentity(null);
}

/** Subscribe to lock/unlock transitions. Returns an unsubscribe. */
export function subscribeSessionIdentity(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
