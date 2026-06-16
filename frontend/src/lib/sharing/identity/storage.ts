// Cross-boundary sharing, on-device identity persistence (Phase 1a; Phase 2 2C).
//
// A thin layer over the in-memory session holder (session-key.ts, the
// authoritative store) plus an at-rest device vault (device-vault.ts). It is
// deliberately ISOLATED from the crypto in keys.ts and backup.ts (which stay
// pure and unit-testable) and from the existing file-system layer
// (lib/file-system/indexeddb-store.ts), which it does NOT import or touch.
//
// Phase 2 Chunk 2C: the at-rest layer no longer persists the RAW keypair. It is
// encrypted under a non-extractable WebCrypto AES-GCM key (device-vault.ts), so
// the keypair never sits raw on disk. The session holder is still the primary
// read; the vault is the reload-survival layer and migrates any legacy raw
// record on first load. The published copies remain the public keys (directory)
// and the wrapped backup blobs (backup.ts).

import type { IdentityKeys } from "./keys";
import {
  encodePublicKey,
  fingerprint as computeFingerprint,
  generateIdentityKeys,
} from "./keys";
import type { KdfParams } from "./backup";
import { generateDeviceSalt } from "./backup";
import {
  clearKeysAtRest,
  loadKeysAtRest,
  persistKeysAtRest,
} from "./device-vault";
import {
  clearSessionIdentity,
  getSessionIdentity,
  setSessionIdentity,
} from "./session-key";
import {
  type WrappedDeviceKey,
  unlockDeviceKeyWithRecovery,
  wrapDeviceKey,
} from "./device-key";
import {
  type SharingIdentitySidecar,
  readSharingIdentity,
  writeSharingIdentity,
} from "./sidecar";
import { ensureGitignoreEntries } from "../../file-system/gitignore";

/**
 * The persisted record for this device, the full identity keypair plus the
 * device salt. The shape is kept stable for existing consumers; under the Phase
 * 2 vault the deviceSalt is vestigial (a fresh throwaway value), since the
 * device-bound passphrase blob it once fed is no longer the at-rest unlock.
 */
export interface StoredIdentity {
  keys: IdentityKeys;
  deviceSalt: Uint8Array;
}

/**
 * Persists this device's identity. The session holder is the PRIMARY store
 * loadIdentity reads, so it lands first. The keypair is then encrypted at rest
 * in the device vault (device-vault.ts) so a page reload re-hydrates without
 * re-entering the recovery words. The deviceSalt is NOT persisted (it is
 * vestigial under the vault); only the keypair is encrypted at rest.
 *
 * Best-effort at-rest write: the vault no-ops on SSR / no-crypto.subtle /
 * blocked IndexedDB. The session key above is authoritative and loadIdentity
 * prefers it, so a failed at-rest persist never breaks identity creation/unlock.
 */
export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  setSessionIdentity(identity);
  await persistKeysAtRest(identity.keys);
}

/**
 * The unlocked identity for this session, or null. Prefers the in-memory session
 * key (populated by an unlock ceremony); falls back to the encrypted at-rest
 * vault, which also migrates any legacy raw record on first load. A fresh
 * deviceSalt is attached to the vault-loaded keys to keep StoredIdentity stable.
 *
 * The vault reads as "no persisted identity" (never throws) when IndexedDB /
 * crypto.subtle are absent or blocked, so callers like restoreSessionFromStore /
 * hasIdentity and the key-rotation publish flow never see an unhandled rejection.
 */
export async function loadIdentity(): Promise<StoredIdentity | null> {
  const session = getSessionIdentity();
  if (session) return session;
  const keys = await loadKeysAtRest();
  if (!keys) return null;
  return toStored(keys);
}

/**
 * Reports whether an identity is already saved on this device.
 */
export async function hasIdentity(): Promise<boolean> {
  return (await loadIdentity()) !== null;
}

/**
 * Boot-time restore. The unlocked identity lives in an in-memory session that is
 * cleared on every page reload, while the key is also persisted in IndexedDB
 * (saveIdentity). Without re-populating the session on boot, the user had to
 * re-unlock ("reconnect their profile") on every refresh. This parks the
 * persisted key back into the session so getSessionIdentity()-direct callers AND
 * useSharingIdentity subscribers see a consistent unlocked state across reloads.
 * No-op + returns false when nothing is persisted (the user then unlocks via
 * recovery code or passkey). Exposes no key that loadIdentity did not already
 * serve from the same IndexedDB record.
 */
export async function restoreSessionFromStore(): Promise<boolean> {
  if (getSessionIdentity()) return true;
  const stored = await loadIdentity();
  if (stored) {
    setSessionIdentity(stored);
    return true;
  }
  return false;
}

/**
 * Removes this device's identity. Used on sign-out or a destructive reset. Does
 * not delete the database itself, so a later save reuses the same store.
 */
export async function clearIdentity(): Promise<void> {
  // Lock the session AND clear the at-rest vault (encrypted payload + the
  // wrapping key + any lingering legacy raw record). The session lock is
  // authoritative; the vault clear is best-effort. Absent / blocked IndexedDB
  // must not turn a successful sign-out into a reported failure ("Could not
  // remove your key from this device") when the key is in fact gone from the
  // session. Mirrors saveIdentity / loadIdentity.
  clearSessionIdentity();
  await clearKeysAtRest();
}

// ---------------------------------------------------------------------------
// OAuth-only identity model, the at-rest unlock + persistence (Option A).
//
// The wrapped device key lives in the per-user sharing sidecar
// (_sharing_identity.json). These functions read/write those wrapped blobs and
// park the unlocked key in the session holder. They are additive, the login
// screen and setup wizard wire them in the next steps.
// ---------------------------------------------------------------------------

function sidecarToWrapped(
  sc: SharingIdentitySidecar,
): WrappedDeviceKey | null {
  if (!sc.recoveryBlob) return null;
  return {
    version: 2,
    x25519PublicKey: sc.x25519PublicKey,
    ed25519PublicKey: sc.ed25519PublicKey,
    fingerprint: sc.fingerprint,
    recoveryBlob: sc.recoveryBlob,
  };
}

function toStored(keys: IdentityKeys): StoredIdentity {
  // deviceSalt is vestigial under the new wrapping (recovery/passkey, not a
  // device-bound passphrase), but StoredIdentity still carries it; a fresh one
  // is harmless and keeps the shape stable for existing consumers.
  return { keys, deviceSalt: generateDeviceSalt() };
}

/**
 * Creates a brand-new LOCAL identity for a user, fully OFFLINE with NO OAuth and
 * NO network. This is the account-creation path under the revised model
 * (IDENTITY_OAUTH_ONLY.md, 2026-06-06): the account IS a local keypair.
 *
 * Steps:
 *   1. generate a fresh keypair,
 *   2. write a public-only sidecar (public keys + fingerprint + createdAt, NO
 *      email, since publishing to the directory is a separate optional step),
 *   3. seal the keypair into that sidecar under a fresh recovery code (this also
 *      parks the unlocked key in the session and gitignores the now-key-bearing
 *      sidecar).
 *
 * Returns the one-time recovery code (and the equivalent 12 words) to show the
 * user once.
 *
 * Argon2id runs inside sealIdentityIntoSidecar (heavy, blocking under PROD
 * params), so call this off the critical paint path the same way the wizard does.
 */
export async function createLocalIdentity(
  username: string,
  params?: KdfParams,
): Promise<{ recoveryCode: string; recoveryWords: string }> {
  const keys = generateIdentityKeys();
  // Wrap in memory FIRST, so the single sidecar write below already carries the
  // recoveryBlob. No email (local-only) and no claimedAt (not published);
  // createdAt records when the account was made on this folder.
  //
  // ATOMICITY: the keypair-bearing recoveryBlob is computed before any disk
  // write and the sidecar is written in ONE writeSharingIdentity call. The
  // earlier two-write sequence (public-only sidecar, then a second write to
  // attach the recoveryBlob) could leave a sidecar with NO recoveryBlob if the
  // second write failed mid-op (disk full, FSA permission revoked), stranding an
  // unrecoverable keypair that the next createLocalIdentity would silently
  // overwrite. With one write, a failed write leaves either the prior file
  // untouched or no file at all, so a retry is clean and never half-writes an
  // account. Argon2id runs in wrapDeviceKey (heavy under PROD params), so call
  // this off the critical paint path the same way the wizard does.
  const { wrapped, recoveryCode, recoveryWords } = params
    ? wrapDeviceKey(keys, params)
    : wrapDeviceKey(keys);
  const sidecar: SharingIdentitySidecar = {
    version: 1,
    x25519PublicKey: encodePublicKey(keys.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(keys.signing.publicKey),
    fingerprint: computeFingerprint(keys.signing.publicKey),
    createdAt: new Date().toISOString(),
    recoveryConfirmedAt: null,
    recoveryBlob: wrapped.recoveryBlob,
  };
  await writeSharingIdentity(username, sidecar);
  try {
    await ensureGitignoreEntries([
      "_sharing_identity.json",
      "users/*/_sharing_identity.json",
    ]);
  } catch {
    // best-effort, the sidecar still works if the append fails
  }
  // Park the unlocked key in the session (+ IndexedDB fallback) only after the
  // key-bearing sidecar is safely on disk.
  await saveIdentity(toStored(keys));
  return { recoveryCode, recoveryWords };
}

/** Unlocks the folder identity with the recovery code or 12 words. */
export async function unlockIdentityWithRecovery(
  username: string,
  codeOrWords: string,
): Promise<StoredIdentity | null> {
  const sc = await readSharingIdentity(username);
  if (!sc) return null;
  const wrapped = sidecarToWrapped(sc);
  if (!wrapped) return null;
  const keys = unlockDeviceKeyWithRecovery(wrapped, codeOrWords);
  if (!keys) return null;
  const identity = toStored(keys);
  // Persist to IndexedDB too, not just the session, so the legacy fallback in
  // loadIdentity() returns THIS identity after a reload instead of a stale older
  // record. A session/IndexedDB mismatch otherwise makes different callers read
  // different identities (broke mobile pairing: QR signed one key, poller read
  // another).
  await saveIdentity(identity);
  return identity;
}

/**
 * Seals a freshly created keypair into the user's sidecar under a new recovery
 * code, parks it in the session, and gitignores the now-key-bearing sidecar.
 * Returns the one-time recovery code/words. The sidecar must already exist (the
 * setup wizard writes its public fields first).
 */
export async function sealIdentityIntoSidecar(
  username: string,
  keys: IdentityKeys,
  params?: KdfParams,
): Promise<{ recoveryCode: string; recoveryWords: string }> {
  const sc = await readSharingIdentity(username);
  if (!sc) {
    throw new Error(
      "sealIdentityIntoSidecar: no sharing sidecar to attach the wrapped key to",
    );
  }
  const { wrapped, recoveryCode, recoveryWords } = params
    ? wrapDeviceKey(keys, params)
    : wrapDeviceKey(keys);
  await writeSharingIdentity(username, {
    ...sc,
    recoveryBlob: wrapped.recoveryBlob,
  });
  try {
    await ensureGitignoreEntries([
      "_sharing_identity.json",
      "users/*/_sharing_identity.json",
    ]);
  } catch {
    // best-effort, the sidecar still works if the append fails
  }
  // Persist (session + IndexedDB) so the freshly created identity is also the
  // one loadIdentity returns after a reload. See unlockIdentityWithRecovery.
  await saveIdentity(toStored(keys));
  return { recoveryCode, recoveryWords };
}

/**
 * Phase B (account/folder/identity redesign, docs/proposals/2026-06-15-account-folder-identity-redesign.md):
 * REUSE an account's existing keypair in a folder instead of minting a new one.
 *
 * Writes a REFERENCE sidecar for `username` carrying ONLY the public identity
 * (public keys + fingerprint + createdAt) and NO recoveryBlob, then parks the
 * already-owned keypair in the session. The keypair is NOT re-wrapped here: its
 * recovery anchor lives at the ACCOUNT level (the device vault, the cloud
 * backup, and the originating folder's recoveryBlob), not in this folder. This
 * is how one cloud account stays the SAME identity across multiple lab folders,
 * so the directory's one-email-one-keypair model is finally correct.
 *
 * SECURITY CONTRACT: the caller MUST have verified that `keys` is the CURRENT
 * account's identity (e.g. the device-vault keypair's public key matches the
 * directory record for the signed-in email) BEFORE calling, so a previous
 * user's vault key can never be sealed into a different person's new folder.
 * This function does no verification of its own.
 */
export async function writeIdentityReferenceSidecar(
  username: string,
  keys: IdentityKeys,
): Promise<void> {
  const sidecar: SharingIdentitySidecar = {
    version: 1,
    x25519PublicKey: encodePublicKey(keys.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(keys.signing.publicKey),
    fingerprint: computeFingerprint(keys.signing.publicKey),
    createdAt: new Date().toISOString(),
    recoveryConfirmedAt: null,
    // No recoveryBlob on purpose: this folder REFERENCES the account identity;
    // recovery is account-level (vault + cloud + the originating folder).
  };
  await writeSharingIdentity(username, sidecar);
  try {
    await ensureGitignoreEntries([
      "_sharing_identity.json",
      "users/*/_sharing_identity.json",
    ]);
  } catch {
    // best-effort; the sidecar still works if the append fails
  }
  await saveIdentity(toStored(keys));
}

/**
 * Phase C (recovery, docs/proposals/2026-06-15-account-folder-identity-redesign.md §4.4):
 * RESET this user's identity while KEEPING their data. The notebook data is
 * plaintext on disk and is NOT touched here; only the cryptographic identity is
 * replaced. This is the lockout escape: a user who has lost their recovery code
 * and provider access, but still holds the folder, can re-establish a fresh
 * identity rather than being permanently locked out.
 *
 * Drops the stale identity from the session + at-rest vault, then mints a fresh
 * keypair + sidecar (overwriting the old sidecar) and returns the new one-time
 * recovery code.
 *
 * WHAT IS LOST: the old signing identity, so prior signatures / provenance
 * orphan, and the ability to decrypt data previously shared TO the old key.
 * WHAT SURVIVES: all of the user's own notebook data (it is plaintext on disk).
 * For a SHARED lab the new public key must be re-admitted to the roster by the
 * lab head (Phase C PI re-admit) before sharing works again.
 */
export async function resetIdentityKeepData(
  username: string,
  params?: KdfParams,
): Promise<{ recoveryCode: string; recoveryWords: string }> {
  // Drop the stale identity from the session + at-rest store so the fresh mint
  // below is unambiguously the active one (createLocalIdentity also parks the
  // new key, but a leftover vault entry must never shadow it).
  await clearIdentity();
  return createLocalIdentity(username, params);
}

/**
 * Stamps recoveryConfirmedAt on the user's sidecar, marking that they saved
 * their recovery words. Called when the user ticks the confirmation checkbox and
 * completes CreateLocalIdentityStep. No-op if the sidecar is absent.
 */
export async function confirmRecoveryInSidecar(username: string): Promise<void> {
  const sc = await readSharingIdentity(username);
  if (!sc) return;
  await writeSharingIdentity(username, {
    ...sc,
    recoveryConfirmedAt: new Date().toISOString(),
  });
}

