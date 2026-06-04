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
  const db = await openDb();
  try {
    await tx(db, "readwrite", (store) =>
      store.put(identity, IDENTITY_KEY),
    );
  } finally {
    db.close();
  }
}

/**
 * Loads this device's identity, or null if none has been saved.
 */
export async function loadIdentity(): Promise<StoredIdentity | null> {
  const db = await openDb();
  try {
    const record = await tx<StoredIdentity | undefined>(db, "readonly", (store) =>
      store.get(IDENTITY_KEY),
    );
    return record ?? null;
  } finally {
    db.close();
  }
}

/**
 * Reports whether an identity is already saved on this device.
 */
export async function hasIdentity(): Promise<boolean> {
  return (await loadIdentity()) !== null;
}

/**
 * Removes this device's identity. Used on sign-out or a destructive reset. Does
 * not delete the database itself, so a later save reuses the same store.
 */
export async function clearIdentity(): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, "readwrite", (store) => store.delete(IDENTITY_KEY));
  } finally {
    db.close();
  }
}
