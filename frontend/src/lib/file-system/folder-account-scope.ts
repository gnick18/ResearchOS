// Per-account scope for the remembered-folders registry (multi-folder hardening).
//
// The remembered-folders registry used to be keyed per browser, so two accounts
// signed in on the same browser shared one folder list. This module derives a
// stable, offline, PII-free namespace from the unlocked account so each account
// gets its own remembered set.
//
// The account IS the local keypair, so the signing public key hex is a stable,
// offline, PII-free per-account namespace. It never changes for an account, it
// needs no network, and it leaks no email or handle. When no identity is
// unlocked, getFolderRegistryScope returns null and the registry falls back to
// the legacy unscoped keys, which is exactly the pre-account behavior.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { loadIdentity } from "@/lib/sharing/identity/storage";
import { encodePublicKey } from "@/lib/sharing/identity/keys";

/**
 * Resolve the per-account registry scope, or null when there is no unlocked
 * identity. The scope is the hex-encoded Ed25519 signing public key of the
 * current account. Returns null on any throw so a registry read never fails
 * just because identity resolution hiccuped, it simply falls back to the legacy
 * unscoped registry.
 */
export async function getFolderRegistryScope(): Promise<string | null> {
  try {
    const id = await loadIdentity();
    if (!id) return null;
    return encodePublicKey(id.keys.signing.publicKey);
  } catch {
    return null;
  }
}
