// Cross-boundary sharing, on-device identity persistence (Phase 1a).
//
// A thin, self-contained IndexedDB wrapper that persists this device's identity
// keypair plus its device salt. It is deliberately ISOLATED from the crypto in
// keys.ts and backup.ts (which stay pure and unit-testable) and from the
// existing file-system layer (lib/file-system/indexeddb-store.ts), which it
// does NOT import or touch. Nothing else in the app imports this yet.
//
// We use a dedicated database name so this never collides with the app's own
// IndexedDB usage. Raw key bytes live on this device only, the published copies
// are the public keys (directory) and the wrapped backup blobs (backup.ts).

import type { IdentityKeys } from "./keys";
import {
  encodePublicKey,
  fingerprint as computeFingerprint,
  generateIdentityKeys,
} from "./keys";
import type { KdfParams } from "./backup";
import { generateDeviceSalt } from "./backup";
import {
  clearSessionIdentity,
  getSessionIdentity,
  setSessionIdentity,
} from "./session-key";
import {
  type WrappedDeviceKey,
  addPasskeyToDeviceKey,
  removePasskeyFromDeviceKey,
  unlockDeviceKeyWithPasskey,
  unlockDeviceKeyWithRecovery,
  wrapDeviceKey,
} from "./device-key";
import {
  type SharingIdentitySidecar,
  readSharingIdentity,
  writeSharingIdentity,
} from "./sidecar";
import { ensureGitignoreEntries } from "../../file-system/gitignore";

const DB_NAME = "researchos-sharing-identity";
const DB_VERSION = 1;
const STORE_NAME = "identity";
const IDENTITY_KEY = "self";

/**
 * The persisted record for this device, the full identity keypair plus the
 * device salt used by the device-bound passphrase backup blob.
 */
export interface StoredIdentity {
  keys: IdentityKeys;
  deviceSalt: Uint8Array;
}

function getIndexedDB(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "IndexedDB is not available in this environment (sharing identity storage requires a browser)",
    );
  }
  return indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = getIndexedDB().open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persists this device's identity, overwriting any existing record. Raw key
 * bytes and the device salt are structured-clonable, so IndexedDB stores them
 * directly with no serialization.
 */
export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  // OAuth-only model: the unlocked key lives in process memory for the session.
  // This is the PRIMARY store loadIdentity reads, so it must land first.
  setSessionIdentity(identity);
  // Transition fallback: also keep the legacy IndexedDB record so a page reload
  // before the passkey-unlock login lands still finds the key. This raw-at-rest
  // store is removed once the login ceremony populates the session on boot.
  //
  // Best-effort: IndexedDB can be absent (SSR / unit tests) or blocked (private
  // browsing, hardened browsers, quota). The session key above is authoritative
  // and loadIdentity prefers it, so a failed fallback persist must never break
  // identity creation / unlock. Skip when there is no IndexedDB, and swallow
  // runtime errors (open blocked, transaction aborted) with a warning.
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    try {
      await tx(db, "readwrite", (store) =>
        store.put(identity, IDENTITY_KEY),
      );
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(
      "[identity] IndexedDB fallback persist failed (non-fatal; session key is authoritative)",
      err,
    );
  }
}

/**
 * The unlocked identity for this session, or null. Prefers the in-memory session
 * key (populated by an unlock ceremony); falls back to the legacy IndexedDB raw
 * record during the transition so existing callers keep working.
 */
export async function loadIdentity(): Promise<StoredIdentity | null> {
  const session = getSessionIdentity();
  if (session) return session;
  // The legacy IndexedDB record is a best-effort fallback. IndexedDB can be
  // absent (SSR / tests) or blocked (private browsing, hardened browsers); that
  // must read as "no persisted identity", never throw — callers like
  // restoreSessionFromStore / hasIdentity and the key-rotation publish flow
  // would otherwise see an unhandled rejection. Mirrors saveIdentity's guard.
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    try {
      const record = await tx<StoredIdentity | undefined>(db, "readonly", (store) =>
        store.get(IDENTITY_KEY),
      );
      return record ?? null;
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(
      "[identity] IndexedDB load failed (treating as no persisted identity)",
      err,
    );
    return null;
  }
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
  // Lock the session AND drop the legacy raw record. The session lock above is
  // authoritative; the IndexedDB delete is best-effort. Absent / blocked
  // IndexedDB must not turn a successful sign-out into a reported failure
  // ("Could not remove your key from this device") when the key is in fact gone
  // from the session. Mirrors saveIdentity / loadIdentity.
  clearSessionIdentity();
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    try {
      await tx(db, "readwrite", (store) => store.delete(IDENTITY_KEY));
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(
      "[identity] IndexedDB clear failed (session already locked)",
      err,
    );
  }
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
    passkeyBlob: sc.passkeyBlob,
    passkeyCredentialId: sc.passkeyCredentialId,
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
 * user once. A passkey can be enrolled afterwards via enrollPasskeyIntoSidecar.
 *
 * Argon2id runs inside sealIdentityIntoSidecar (heavy, blocking under PROD
 * params), so call this off the critical paint path the same way the wizard does.
 */
export async function createLocalIdentity(
  username: string,
  params?: KdfParams,
): Promise<{ recoveryCode: string; recoveryWords: string }> {
  const keys = generateIdentityKeys();
  // Public-only sidecar first, so sealIdentityIntoSidecar has a file to attach
  // the wrapped key to. No email (local-only) and no claimedAt (not published);
  // createdAt records when the account was made on this folder.
  const publicSidecar: SharingIdentitySidecar = {
    version: 1,
    x25519PublicKey: encodePublicKey(keys.encryption.publicKey),
    ed25519PublicKey: encodePublicKey(keys.signing.publicKey),
    fingerprint: computeFingerprint(keys.signing.publicKey),
    createdAt: new Date().toISOString(),
    recoveryConfirmedAt: null,
  };
  await writeSharingIdentity(username, publicSidecar);
  // Seals the keypair under a fresh recovery code, writes the recoveryBlob onto
  // the sidecar, parks the unlocked key in the session, and gitignores the file.
  return sealIdentityIntoSidecar(username, keys, params);
}

/** The passkey credential id to ask for at unlock, or null when none enrolled. */
export async function getPasskeyCredentialId(
  username: string,
): Promise<string | null> {
  const sc = await readSharingIdentity(username);
  return sc?.passkeyCredentialId ?? null;
}

/** Whether this user's folder identity has a passkey door on this device. */
export async function sidecarHasPasskey(username: string): Promise<boolean> {
  const sc = await readSharingIdentity(username);
  return !!sc?.passkeyBlob;
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

/** Unlocks the folder identity with a passkey PRF output (from webauthn.ts). */
export async function unlockIdentityWithPasskey(
  username: string,
  prfOutput: Uint8Array,
): Promise<StoredIdentity | null> {
  const sc = await readSharingIdentity(username);
  if (!sc) return null;
  const wrapped = sidecarToWrapped(sc);
  if (!wrapped) return null;
  const keys = unlockDeviceKeyWithPasskey(wrapped, prfOutput);
  if (!keys) return null;
  const identity = toStored(keys);
  // Persist (session + IndexedDB) so a later reload's loadIdentity fallback
  // returns this identity, not a stale one. See unlockIdentityWithRecovery.
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
 * Adds (or replaces) the passkey door on the user's sidecar, using the current
 * session key plus a fresh PRF output from an enrollment ceremony.
 */
export async function enrollPasskeyIntoSidecar(
  username: string,
  prfOutput: Uint8Array,
  credentialId: string,
): Promise<boolean> {
  const sc = await readSharingIdentity(username);
  const session = getSessionIdentity();
  if (!sc || !sc.recoveryBlob || !session) return false;
  const wrapped = addPasskeyToDeviceKey(
    sidecarToWrapped(sc) as WrappedDeviceKey,
    session.keys,
    prfOutput,
    credentialId,
  );
  await writeSharingIdentity(username, {
    ...sc,
    passkeyBlob: wrapped.passkeyBlob,
    passkeyCredentialId: wrapped.passkeyCredentialId,
    passkeyEnrolledAt: new Date().toISOString(),
  });
  return true;
}

/** Removes the passkey door, leaving recovery-only unlock. */
export async function removePasskeyFromSidecar(
  username: string,
): Promise<boolean> {
  const sc = await readSharingIdentity(username);
  if (!sc || !sc.recoveryBlob) return false;
  const stripped = removePasskeyFromDeviceKey(sidecarToWrapped(sc) as WrappedDeviceKey);
  await writeSharingIdentity(username, {
    ...sc,
    passkeyBlob: stripped.passkeyBlob,
    passkeyCredentialId: stripped.passkeyCredentialId,
    passkeyEnrolledAt: null,
  });
  return true;
}
