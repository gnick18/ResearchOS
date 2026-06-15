// Cloud-accounts Phase 2, Chunk 2C: the at-rest device-key vault.
//
// The unlocked identity keypair lives in the in-memory session (session-key.ts)
// for the duration of a tab. To survive a page reload without re-entering the
// recovery words every time, SOME key material must persist on the device. The
// old transition fallback persisted the RAW keypair in IndexedDB, which the
// Phase 2 audit flagged. This module replaces that with a wrapped-at-rest scheme
// (the locked Option A from the design doc):
//
//   1. A NON-EXTRACTABLE WebCrypto AES-GCM key is generated once with
//      crypto.subtle.generateKey(..., extractable=false, ...) and stored in
//      IndexedDB. Structured clone persists a non-extractable CryptoKey as a
//      handle; its raw bytes are NEVER exposed to JS and never leave the browser.
//   2. The identity keypair is serialized to bytes deterministically and stored
//      as AES-GCM ciphertext under that key, with a fresh random 12-byte IV per
//      encrypt.
//
// So the keypair is never sitting raw on disk. The threat model is the realistic
// one for a local-first tool: a local attacker with the unlocked device profile
// can still ask the browser to decrypt (same as any local-first app), but a
// casual dump of the IndexedDB contents yields only ciphertext plus an opaque,
// non-extractable key handle.
//
// SSR / no-crypto.subtle / no-indexedDB all behave as "nothing persisted" so the
// session holder stays authoritative and nothing here ever throws on the caller.
//
// This module is deliberately isolated: it imports the pure key types/encoders
// from keys.ts and nothing from storage.ts (storage.ts depends on US, not the
// reverse), so there is no import cycle.
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  type IdentityKeys,
  decodePublicKey,
  encodePublicKey,
} from "./keys";

const DB_NAME = "researchos-sharing-identity";
// Bump the DB version so the new vault store is created on existing devices that
// already opened v1 (which only had the legacy "identity" store).
const DB_VERSION = 2;
// The legacy raw-keypair store + record key (storage.ts v1). We read it once for
// migration, then delete the record.
const LEGACY_STORE = "identity";
const LEGACY_KEY = "self";
// The vault store: one record holds the non-extractable AES key, another holds
// the encrypted keypair payload.
const VAULT_STORE = "device-vault";
const WRAP_KEY_RECORD = "wrap-key";
const PAYLOAD_RECORD = "keys-ciphertext";

const AES_PARAMS = { name: "AES-GCM", length: 256 } as const;
const IV_BYTES = 12; // AES-GCM standard nonce length.

/** The encrypted-at-rest payload as stored in IndexedDB. iv + AES-GCM ciphertext. */
interface VaultPayload {
  v: 1;
  iv: Uint8Array;
  ciphertext: Uint8Array; // includes the GCM tag.
}

/** The legacy raw record shape that storage.ts v1 persisted. */
interface LegacyStored {
  keys: IdentityKeys;
  deviceSalt?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Environment guards. Any of these missing means "no at-rest layer available";
// the in-memory session stays authoritative and callers degrade gracefully.
// ---------------------------------------------------------------------------

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function hasSubtle(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  );
}

function vaultAvailable(): boolean {
  return hasIndexedDB() && hasSubtle();
}

// ---------------------------------------------------------------------------
// Deterministic keypair serialization. We serialize the four raw keys as hex in
// a fixed order so encrypt/decrypt round-trips byte-for-byte and the public
// halves are re-derivable on load. This is a PURE helper, exported for unit
// tests so the serialize -> encrypt -> decrypt path can be checked without IDB.
// ---------------------------------------------------------------------------

interface SerializedKeys {
  encPub: string;
  encPriv: string;
  sigPub: string;
  sigPriv: string;
}

/** Serializes an identity keypair to deterministic UTF-8 JSON bytes (hex keys). */
export function serializeIdentityKeys(keys: IdentityKeys): Uint8Array {
  const obj: SerializedKeys = {
    encPub: encodePublicKey(keys.encryption.publicKey),
    encPriv: encodePublicKey(keys.encryption.privateKey),
    sigPub: encodePublicKey(keys.signing.publicKey),
    sigPriv: encodePublicKey(keys.signing.privateKey),
  };
  return new TextEncoder().encode(JSON.stringify(obj));
}

/** Parses the bytes produced by serializeIdentityKeys back into a keypair. */
export function deserializeIdentityKeys(bytes: Uint8Array): IdentityKeys {
  const obj = JSON.parse(new TextDecoder().decode(bytes)) as SerializedKeys;
  return {
    encryption: {
      publicKey: decodePublicKey(obj.encPub),
      privateKey: decodePublicKey(obj.encPriv),
    },
    signing: {
      publicKey: decodePublicKey(obj.sigPub),
      privateKey: decodePublicKey(obj.sigPriv),
    },
  };
}

// ---------------------------------------------------------------------------
// Pure AES-GCM encrypt/decrypt against a CryptoKey. Exported for unit tests so
// the round-trip can be checked with an in-test generated key, no IDB needed.
// ---------------------------------------------------------------------------

/** Encrypts serialized keypair bytes under an AES-GCM CryptoKey with a fresh IV. */
export async function encryptUnderVaultKey(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<VaultPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    toArrayBuffer(plaintext),
  );
  return { v: 1, iv, ciphertext: new Uint8Array(buf) };
}

/** Decrypts a vault payload under its AES-GCM CryptoKey back to plaintext bytes. */
export async function decryptUnderVaultKey(
  key: CryptoKey,
  payload: VaultPayload,
): Promise<Uint8Array> {
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(payload.iv) },
    key,
    toArrayBuffer(payload.ciphertext),
  );
  return new Uint8Array(buf);
}

// Normalize a Uint8Array (which may be a view over a larger buffer) into a tight
// ArrayBuffer for the WebCrypto calls, which want a BufferSource.
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing. Mirrors storage.ts's thin wrapper but owns the schema
// upgrade that adds the vault store alongside the legacy one.
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Keep the legacy store around so a pending migration can still read it.
      if (!db.objectStoreNames.contains(LEGACY_STORE)) {
        db.createObjectStore(LEGACY_STORE);
      }
      if (!db.objectStoreNames.contains(VAULT_STORE)) {
        db.createObjectStore(VAULT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txGet<T>(
  db: IDBDatabase,
  store: string,
  key: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readonly");
    const req = transaction.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txPut(
  db: IDBDatabase,
  store: string,
  key: string,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const req = transaction.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const req = transaction.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// The wrapping key. Generated once as a NON-EXTRACTABLE AES-GCM key and stored
// in IndexedDB by structured clone, so the raw bytes never touch JS.
// ---------------------------------------------------------------------------

async function getOrCreateWrapKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await txGet<CryptoKey>(db, VAULT_STORE, WRAP_KEY_RECORD);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(AES_PARAMS, false, [
    "encrypt",
    "decrypt",
  ]);
  await txPut(db, VAULT_STORE, WRAP_KEY_RECORD, key);
  return key;
}

// ---------------------------------------------------------------------------
// Public API. persist / load / clear the at-rest keypair. All guarded so a
// missing or blocked environment reads as "nothing persisted" and never throws.
// ---------------------------------------------------------------------------

/**
 * Encrypts and persists the identity keypair at rest under the device's
 * non-extractable wrapping key. Best-effort: no-op when the vault is unavailable
 * (SSR, no crypto.subtle, no IndexedDB) or when IndexedDB is blocked. The session
 * holder is always the authoritative store, so a failed persist must never break
 * identity creation or unlock.
 */
export async function persistKeysAtRest(keys: IdentityKeys): Promise<void> {
  if (!vaultAvailable()) return;
  try {
    const db = await openDb();
    try {
      const wrapKey = await getOrCreateWrapKey(db);
      const payload = await encryptUnderVaultKey(wrapKey, serializeIdentityKeys(keys));
      await txPut(db, VAULT_STORE, PAYLOAD_RECORD, payload);
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(
      "[identity] device-vault persist failed (non-fatal; session key is authoritative)",
      err,
    );
  }
}

/**
 * Loads and decrypts the at-rest keypair, or null when nothing is persisted.
 *
 * MIGRATION: if no encrypted vault payload exists but the LEGACY raw "self"
 * record from storage.ts v1 is present, this reads that keypair, re-encrypts it
 * under the new vault, deletes the legacy raw record, and returns the keypair.
 * Existing users therefore keep their key, and the raw copy is removed on first
 * load under the new code.
 *
 * Best-effort and never throws: an unavailable or blocked environment, or a
 * corrupt payload, reads as "nothing persisted" so callers fall back to the
 * session holder / a fresh unlock.
 */
export async function loadKeysAtRest(): Promise<IdentityKeys | null> {
  if (!vaultAvailable()) return null;
  try {
    const db = await openDb();
    try {
      // Prefer the encrypted payload.
      const payload = await txGet<VaultPayload>(db, VAULT_STORE, PAYLOAD_RECORD);
      if (payload && payload.iv && payload.ciphertext) {
        const wrapKey = await txGet<CryptoKey>(db, VAULT_STORE, WRAP_KEY_RECORD);
        if (!wrapKey) {
          // Payload without its key is unrecoverable; treat as nothing persisted.
          return null;
        }
        const bytes = await decryptUnderVaultKey(wrapKey, payload);
        return deserializeIdentityKeys(bytes);
      }

      // No vault payload yet: try a one-time migration of the legacy raw record.
      const legacy = await txGet<LegacyStored>(db, LEGACY_STORE, LEGACY_KEY);
      if (legacy && legacy.keys) {
        const keys = legacy.keys;
        // Re-encrypt under the vault FIRST, so a crash mid-migration never loses
        // the key (the legacy record is only deleted after the vault write).
        const wrapKey = await getOrCreateWrapKey(db);
        const migrated = await encryptUnderVaultKey(
          wrapKey,
          serializeIdentityKeys(keys),
        );
        await txPut(db, VAULT_STORE, PAYLOAD_RECORD, migrated);
        await txDelete(db, LEGACY_STORE, LEGACY_KEY);
        return keys;
      }

      return null;
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(
      "[identity] device-vault load failed (treating as no persisted identity)",
      err,
    );
    return null;
  }
}

/**
 * Removes the at-rest keypair (the encrypted payload AND the wrapping key) plus
 * any lingering legacy raw record. Used on sign-out or a destructive reset.
 * Best-effort: a missing or blocked environment is a successful no-op so a
 * sign-out is never reported as failed when the session is already locked.
 */
export async function clearKeysAtRest(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDb();
    try {
      await txDelete(db, VAULT_STORE, PAYLOAD_RECORD);
      await txDelete(db, VAULT_STORE, WRAP_KEY_RECORD);
      await txDelete(db, LEGACY_STORE, LEGACY_KEY);
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(
      "[identity] device-vault clear failed (session already locked)",
      err,
    );
  }
}
