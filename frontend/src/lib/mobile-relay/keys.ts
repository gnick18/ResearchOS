// Runtime accessor that turns the unlocked session identity into the shape the
// capture-relay client signs with.
//
// The single source of the unlocked Ed25519 keypair for the logged-in session
// is `loadIdentity()` (lib/sharing/identity/storage.ts). It returns the
// in-memory session key (populated by the unlock ceremony) or the legacy
// IndexedDB record, with NO password prompt, exactly what the relay client and
// the inbox poller need. When no identity is on hand here this returns null and
// the caller stays dark (the "needs restore" state).

import { loadIdentity } from "@/lib/sharing/identity/storage";
import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { UserCaptureKeys } from "./client";

/** The unlocked user capture keys for this session, or null when none is on hand. */
export async function loadUserCaptureKeys(): Promise<UserCaptureKeys | null> {
  const identity = await loadIdentity();
  if (!identity) return null;
  return {
    ed25519PublicKeyHex: encodePublicKey(identity.keys.signing.publicKey),
    ed25519PrivateKey: identity.keys.signing.privateKey,
    // The X25519 encryption public key is the identity sealing key (what bundles
    // are sealed to). The pairing grant carries it so the phone can seal
    // route-capture commands back to this laptop.
    x25519PublicKeyHex: encodePublicKey(identity.keys.encryption.publicKey),
  };
}
