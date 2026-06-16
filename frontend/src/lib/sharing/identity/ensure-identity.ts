// Solo-deferred identity, the single on-demand mint chokepoint
// (docs/proposals/2026-06-15-account-folder-identity-redesign.md §8).
//
// A solo user gets NO cryptographic keypair until they take a SHARING action
// (publish a findable profile, create/join a lab, share a record, enable at-rest
// encryption). Every such entry point calls ensureLocalIdentity() instead of
// minting ad hoc, so a keypair is minted exactly once, on demand, and never
// invisibly: when this mints, the caller surfaces the returned recovery code
// ("save your recovery code") before completing the action.
//
// This is the get-or-mint chokepoint:
//   - already has a (full or reference) identity for this folder -> no-op.
//   - no identity yet -> mint via createLocalIdentity and hand back the one-time
//     recovery code/words for the caller to display.
//
// The "an account exists here" signal is the per-user sidecar (sidecar.ts): a
// full local identity carries a recoveryBlob, a reference sidecar carries the
// public keys (recovery is account-level). Either means "do not mint again", so
// we key on sidecar presence rather than file-by-file crypto checks.

import { readSharingIdentity } from "./sidecar";
import { createLocalIdentity } from "./storage";

export interface EnsureIdentityResult {
  /** True when this call minted a fresh keypair (caller must surface the code). */
  created: boolean;
  /** The one-time recovery code, present only when created. */
  recoveryCode?: string;
  /** The equivalent 12 words, present only when created. */
  recoveryWords?: string;
}

/**
 * Ensures `username` has a local identity keypair, minting one on demand if not.
 * Idempotent: if a sidecar already exists for the user (full or reference),
 * returns `{ created: false }` and mints nothing. Otherwise mints a fresh
 * keypair (sealed under a new recovery code) and returns the code/words so the
 * caller can show the user their recovery code exactly once.
 *
 * `params` is forwarded to createLocalIdentity (e.g. fast KDF params in tests);
 * omit it in production to use the default Argon2id parameters.
 */
export async function ensureLocalIdentity(
  username: string,
  params?: Parameters<typeof createLocalIdentity>[1],
): Promise<EnsureIdentityResult> {
  // Already provisioned in this folder (full identity OR an account reference)?
  // The sidecar's mere presence is the canonical "an account exists here" signal,
  // so never mint a second keypair over it (which would fork the identity).
  const existing = await readSharingIdentity(username);
  if (existing) return { created: false };

  // First sharing action for a so-far keyless solo user: mint now.
  const { recoveryCode, recoveryWords } = await createLocalIdentity(
    username,
    params,
  );
  return { created: true, recoveryCode, recoveryWords };
}
