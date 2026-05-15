import { get, set, del } from "idb-keyval";

const DIRECTORY_HANDLE_KEY = "research-os-directory-handle";
const CURRENT_USER_KEY = "research-os-current-user";
const MAIN_USER_KEY = "research-os-main-user";
const STORE_NAME = "handles";
const DB_NAME = "research-os-fsa";

// Pre-demo backup keys: written by `installWikiCaptureFixture` BEFORE it
// overwrites the main keys with the fake fixture handle + "alex" user, so
// that LeaveDemoModal (and the stale-state cleanup in FileSystemProvider)
// can restore the user's real-folder connection on the way out. Without
// this, a user with a connected real folder who briefly visits `/demo`
// loses their folder grant and lands on the picker after Leave Demo.
const PRE_DEMO_DIRECTORY_HANDLE_KEY = "research-os-pre-demo-directory-handle";
const PRE_DEMO_CURRENT_USER_KEY = "research-os-pre-demo-current-user";
const PRE_DEMO_MAIN_USER_KEY = "research-os-pre-demo-main-user";

// Sentinel name written by the wiki-capture fixture mock onto its fake
// directory handle. Used here to skip backing up a fake handle on top of
// a previously-saved real handle (idempotency for double-install). Mirrors
// the sentinel checked by FileSystemProvider's stale-state cleanup.
const FIXTURE_HANDLE_SENTINEL = "wiki-capture-fixture";

let cachedHandle: FileSystemDirectoryHandle | null = null;
let dbInitialized = false;

async function initDB(): Promise<IDBDatabase | null> {
  if (dbInitialized) {
    try {
      return await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        dbInitialized = true;
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(null);
      };
      request.onblocked = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function storeDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  cachedHandle = handle;
  
  const db = await initDB();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(handle, DIRECTORY_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore IndexedDB errors
    } finally {
      db.close();
    }
  }

  try {
    await set(DIRECTORY_HANDLE_KEY + "-meta", {
      name: handle.name,
      grantedAt: Date.now(),
    });
  } catch {
    // Ignore keyval errors
  }
}

export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedHandle) {
    return cachedHandle;
  }

  const db = await initDB();
  if (!db) {
    return null;
  }

  try {
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    
    if (handle) {
      cachedHandle = handle;
    }
    return handle;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function getStoredDirectoryMeta(): Promise<{ name: string; grantedAt: number } | null> {
  try {
    return (await get<{ name: string; grantedAt: number }>(DIRECTORY_HANDLE_KEY + "-meta")) || null;
  } catch {
    return null;
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  cachedHandle = null;
  
  const db = await initDB();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(DIRECTORY_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore errors
    } finally {
      db.close();
    }
  }

  try {
    await del(DIRECTORY_HANDLE_KEY + "-meta");
  } catch {
    // Ignore errors
  }
}

export async function storeCurrentUser(username: string): Promise<void> {
  try {
    await set(CURRENT_USER_KEY, username);
  } catch {
    // Ignore errors
  }
}

export async function getCurrentUser(): Promise<string | null> {
  try {
    const user = (await get<string>(CURRENT_USER_KEY)) || null;
    console.log("[indexeddb-store.getCurrentUser] Retrieved user from IndexedDB:", user);
    return user;
  } catch (err) {
    console.error("[indexeddb-store.getCurrentUser] Error:", err);
    return null;
  }
}

export async function storeMainUser(username: string): Promise<void> {
  try {
    await set(MAIN_USER_KEY, username);
  } catch {
    // Ignore errors
  }
}

export async function getMainUser(): Promise<string | null> {
  try {
    return (await get<string>(MAIN_USER_KEY)) || null;
  } catch {
    return null;
  }
}

export async function clearCurrentUser(): Promise<void> {
  try {
    await del(CURRENT_USER_KEY);
    console.log("[indexeddb-store.clearCurrentUser] Cleared current user from IndexedDB");
  } catch (err) {
    console.error("[indexeddb-store.clearCurrentUser] Error:", err);
  }
}

export async function clearMainUser(): Promise<void> {
  try {
    await del(MAIN_USER_KEY);
  } catch (err) {
    console.error("[indexeddb-store.clearMainUser] Error:", err);
  }
}

// ── Pre-demo backup helpers ────────────────────────────────────────────────
//
// These mirror the shape of the main-key helpers above but never touch the
// `cachedHandle` module-level cache (the cache models the LIVE handle the
// app is using; backups are inert until restore time).

export async function storePreDemoDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await initDB();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(handle, PRE_DEMO_DIRECTORY_HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore IndexedDB errors
    } finally {
      db.close();
    }
  }
}

export async function getPreDemoDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await initDB();
  if (!db) return null;
  try {
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(PRE_DEMO_DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function clearPreDemoDirectoryHandle(): Promise<void> {
  const db = await initDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(PRE_DEMO_DIRECTORY_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore errors
  } finally {
    db.close();
  }
}

export async function storePreDemoCurrentUser(username: string): Promise<void> {
  try {
    await set(PRE_DEMO_CURRENT_USER_KEY, username);
  } catch {
    // Ignore errors
  }
}

export async function getPreDemoCurrentUser(): Promise<string | null> {
  try {
    return (await get<string>(PRE_DEMO_CURRENT_USER_KEY)) || null;
  } catch {
    return null;
  }
}

export async function clearPreDemoCurrentUser(): Promise<void> {
  try {
    await del(PRE_DEMO_CURRENT_USER_KEY);
  } catch {
    // Ignore errors
  }
}

export async function storePreDemoMainUser(username: string): Promise<void> {
  try {
    await set(PRE_DEMO_MAIN_USER_KEY, username);
  } catch {
    // Ignore errors
  }
}

export async function getPreDemoMainUser(): Promise<string | null> {
  try {
    return (await get<string>(PRE_DEMO_MAIN_USER_KEY)) || null;
  } catch {
    return null;
  }
}

export async function clearPreDemoMainUser(): Promise<void> {
  try {
    await del(PRE_DEMO_MAIN_USER_KEY);
  } catch {
    // Ignore errors
  }
}

/**
 * Capture the current main-key state (real folder handle + users) into the
 * pre-demo backup keys so the demo-leave path can restore it. Idempotent
 * across repeated demo entries: if the main `directoryHandle` is already
 * the fixture's fake handle (sentinel name), this is a NO-OP — the prior
 * real-handle backup is preserved untouched. Likewise no-op when there's
 * no real handle to back up.
 */
export async function backupRealHandleForDemo(): Promise<void> {
  const handle = await getStoredDirectoryHandle();
  if (!handle) return;
  if (handle.name === FIXTURE_HANDLE_SENTINEL) return;

  const [currentUser, mainUser] = await Promise.all([
    getCurrentUser(),
    getMainUser(),
  ]);

  await storePreDemoDirectoryHandle(handle);
  if (currentUser) await storePreDemoCurrentUser(currentUser);
  else await clearPreDemoCurrentUser();
  if (mainUser) await storePreDemoMainUser(mainUser);
  else await clearPreDemoMainUser();
}

/**
 * Demo-leave finalizer. If a pre-demo backup exists, restore it onto the
 * main keys and clear the backup. Otherwise clear the main keys (the
 * existing public-demo behavior — visitor arrived without a real folder).
 *
 * Returns true when a real-folder restore happened, false when the main
 * keys were cleared.
 *
 * The `cachedHandle` in this module is reset by both branches: restore via
 * `storeDirectoryHandle`, clear via `clearDirectoryHandle`.
 */
export async function restorePreDemoStateOrClear(): Promise<boolean> {
  const preHandle = await getPreDemoDirectoryHandle();

  if (preHandle) {
    const [preCurrent, preMain] = await Promise.all([
      getPreDemoCurrentUser(),
      getPreDemoMainUser(),
    ]);

    await storeDirectoryHandle(preHandle);
    if (preCurrent) await storeCurrentUser(preCurrent);
    else await clearCurrentUser();
    if (preMain) await storeMainUser(preMain);
    else await clearMainUser();

    await Promise.all([
      clearPreDemoDirectoryHandle(),
      clearPreDemoCurrentUser(),
      clearPreDemoMainUser(),
    ]);
    return true;
  }

  await Promise.all([
    clearDirectoryHandle(),
    clearCurrentUser(),
    clearMainUser(),
    // Defensive: prior orphan backup keys (unlikely but possible across app
    // versions) shouldn't survive a Leave Demo into the no-real-folder path.
    clearPreDemoCurrentUser(),
    clearPreDemoMainUser(),
  ]);
  return false;
}
