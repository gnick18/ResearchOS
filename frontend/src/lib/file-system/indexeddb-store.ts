import { get, set, del } from "idb-keyval";
import { getFolderRegistryScope } from "./folder-account-scope";

const DIRECTORY_HANDLE_KEY = "research-os-directory-handle";
const CURRENT_USER_KEY = "research-os-current-user";
const MAIN_USER_KEY = "research-os-main-user";
const STORE_NAME = "handles";
const CACHE_STORE_NAME = "file-cache";
const BLOB_CACHE_STORE = "image-cache";
const DB_NAME = "research-os-fsa";
const DB_VERSION = 3;

export interface CacheEntry {
  key: string;          // `${folderName}::${path}`
  lastModified: number; // File.lastModified at cache time
  data: unknown;        // parsed JSON object or string
  kind: "json" | "text";
}

export interface BlobCacheEntry {
  key: string;          // `${folderName}::${path}`
  lastModified: number;
  blob: Blob;
  size: number;         // blob.size, for budget tracking
  cachedAt: number;     // Date.now(), for LRU eviction
}

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

// ── Per-tab demo identity ───────────────────────────────────────────────────
//
// THE CROSS-TAB POISONING FIX. The demo fixture identity (the "alex" user
// and the inert fixture directory handle) used to be written straight into
// the IndexedDB main keys above. Those keys are SHARED across every
// same-origin tab, so a demo tab could leak its fixture identity into a
// real-folder tab and, in the worst case, seed a stray `users/alex` folder
// into the user's real research folder.
//
// The demo / wiki-capture *flags* are already per-tab (sessionStorage:
// `researchos:demo-mode` from markDemoMode, `researchos:wiki-capture-mode`
// from getWikiCaptureVariant). So we scope the fixture identity to the same
// per-tab sessionStorage. When THIS tab is a fixture tab, the identity
// getters/setters below resolve against sessionStorage and never touch the
// shared IDB main keys. A normal tab never reads them.
//
// We re-derive "is this a fixture tab?" locally instead of importing
// getDemoMode / isWikiCaptureMode from wiki-capture-mock, because
// wiki-capture-mock imports this module (storeDirectoryHandle etc.) and the
// reverse import would be a cycle. The logic mirrors those helpers (the
// sessionStorage sticky flags first, then the URL triggers).
const DEMO_MODE_KEY = "researchos:demo-mode";
const WIKI_CAPTURE_STICKY_KEY = "researchos:wiki-capture-mode";
const DEMO_CURRENT_USER_KEY = "researchos:demo-current-user";
const DEMO_MAIN_USER_KEY = "researchos:demo-main-user";
// Marks that a (fake) directory handle is "connected" in this fixture tab.
// We cannot serialize the inert fixture handle into sessionStorage, so we
// store a flag and reconstruct the sentinel-named stand-in on read.
const DEMO_HANDLE_FLAG_KEY = "researchos:demo-handle";

/** True when THIS tab is running the public demo or the screenshot fixture
 *  (`?wikiCapture=…`). Mirrors wiki-capture-mock's getDemoMode +
 *  isWikiCaptureMode (sessionStorage sticky flags first, then the URL
 *  triggers). Kept local to avoid an import cycle. SSR-safe. */
function isDemoTab(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(DEMO_MODE_KEY) === "1") return true;
    if (window.sessionStorage.getItem(WIKI_CAPTURE_STICKY_KEY) !== null) return true;
  } catch {
    // sessionStorage can throw in privacy modes; fall through to URL.
  }
  try {
    const path = window.location.pathname;
    if (path === "/demo" || path.startsWith("/demo/")) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") return true;
    if (params.get("wikiCapture") !== null) return true;
  } catch {
    // Ignore.
  }
  return false;
}

function readDemoIdentity(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDemoIdentity(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

function deleteDemoIdentity(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

/** The inert demo directory handle. Sentinel-named so any code path that
 *  inspects handle.name treats it as the fixture, not a real folder. */
function makeDemoHandle(): FileSystemDirectoryHandle {
  return {
    name: FIXTURE_HANDLE_SENTINEL,
    kind: "directory",
  } as unknown as FileSystemDirectoryHandle;
}

/** Clear the per-tab demo identity. Called by the demo-leave finalizer so a
 *  tab that exits demo mode stops resolving the fixture identity. */
function clearDemoIdentity(): void {
  deleteDemoIdentity(DEMO_CURRENT_USER_KEY);
  deleteDemoIdentity(DEMO_MAIN_USER_KEY);
  deleteDemoIdentity(DEMO_HANDLE_FLAG_KEY);
}

let cachedHandle: FileSystemDirectoryHandle | null = null;
let dbInitialized = false;

async function initDB(): Promise<IDBDatabase | null> {
  if (dbInitialized) {
    try {
      return await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
          db.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(BLOB_CACHE_STORE)) {
          db.createObjectStore(BLOB_CACHE_STORE, { keyPath: "key" });
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

export async function getCacheEntry(key: string): Promise<CacheEntry | null> {
  if (isDemoTab()) return null;
  const db = await initDB();
  if (!db) return null;
  try {
    return await new Promise<CacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, "readonly");
      const store = tx.objectStore(CACHE_STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as CacheEntry) || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function putCacheEntry(entry: CacheEntry): Promise<void> {
  if (isDemoTab()) return;
  const db = await initDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, "readwrite");
      const store = tx.objectStore(CACHE_STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  } finally {
    db.close();
  }
}

const MANIFEST_MTIME_PREFIX = "cache-manifest-mtime::";

export async function getManifestMtime(folderName: string): Promise<number | null> {
  if (isDemoTab()) return null;
  try {
    return (await get<number>(MANIFEST_MTIME_PREFIX + folderName)) ?? null;
  } catch {
    return null;
  }
}

export async function setManifestMtime(folderName: string, mtime: number): Promise<void> {
  if (isDemoTab()) return;
  try {
    await set(MANIFEST_MTIME_PREFIX + folderName, mtime);
  } catch {
    // best-effort
  }
}

export async function deleteCacheEntry(key: string): Promise<void> {
  if (isDemoTab()) return;
  const db = await initDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, "readwrite");
      const store = tx.objectStore(CACHE_STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  } finally {
    db.close();
  }
}

export async function getBlobCacheEntry(key: string): Promise<BlobCacheEntry | null> {
  if (isDemoTab()) return null;
  const db = await initDB();
  if (!db) return null;
  try {
    return await new Promise<BlobCacheEntry | null>((resolve, reject) => {
      const tx = db.transaction(BLOB_CACHE_STORE, "readonly");
      const store = tx.objectStore(BLOB_CACHE_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as BlobCacheEntry) || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function putBlobCacheEntry(entry: BlobCacheEntry): Promise<void> {
  if (isDemoTab()) return;
  const db = await initDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_CACHE_STORE, "readwrite");
      const store = tx.objectStore(BLOB_CACHE_STORE);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  } finally {
    db.close();
  }
}

export async function deleteBlobCacheEntry(key: string): Promise<void> {
  if (isDemoTab()) return;
  const db = await initDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_CACHE_STORE, "readwrite");
      const store = tx.objectStore(BLOB_CACHE_STORE);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  } finally {
    db.close();
  }
}

const BLOB_BUDGET_PREFIX = "image-cache-budget::";

export async function getBlobCacheBudget(folderName: string): Promise<number> {
  if (isDemoTab()) return 0;
  try {
    return (await get<number>(BLOB_BUDGET_PREFIX + folderName)) ?? 0;
  } catch {
    return 0;
  }
}

export async function setBlobCacheBudget(folderName: string, bytes: number): Promise<void> {
  if (isDemoTab()) return;
  try {
    await set(BLOB_BUDGET_PREFIX + folderName, bytes);
  } catch {
    // best-effort
  }
}

export async function evictBlobCacheUntil(
  folderName: string,
  targetBytes: number
): Promise<void> {
  if (isDemoTab()) return;
  const db = await initDB();
  if (!db) return;
  try {
    const prefix = `${folderName}::`;
    const entries: BlobCacheEntry[] = [];

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_CACHE_STORE, "readwrite");
      const store = tx.objectStore(BLOB_CACHE_STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        const entry = cursor.value as BlobCacheEntry;
        if (entry.key.startsWith(prefix)) {
          entries.push(entry);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });

    entries.sort((a, b) => a.cachedAt - b.cachedAt);

    let freed = 0;
    const toDelete: string[] = [];
    for (const entry of entries) {
      if (freed >= targetBytes) break;
      toDelete.push(entry.key);
      freed += entry.size;
    }

    if (toDelete.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_CACHE_STORE, "readwrite");
      const store = tx.objectStore(BLOB_CACHE_STORE);
      for (const key of toDelete) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const current = await getBlobCacheBudget(folderName);
    await setBlobCacheBudget(folderName, Math.max(0, current - freed));
  } catch {
    // best-effort
  } finally {
    db.close();
  }
}

export async function storeDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  // Per-tab demo isolation. In a demo tab, keep the (fake) handle live for
  // THIS tab only via the in-process cache + a per-tab sessionStorage flag,
  // and never write the shared IndexedDB main key. This is what stops the
  // fixture handle from leaking into a real-folder tab on the same origin.
  if (isDemoTab()) {
    cachedHandle = handle;
    writeDemoIdentity(DEMO_HANDLE_FLAG_KEY, "1");
    return;
  }

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
  // Per-tab demo isolation. A demo tab resolves the inert fixture handle
  // from its own per-tab flag (or the live in-process cache) and never reads
  // the shared IDB main key. A non-demo tab continues past this block.
  if (isDemoTab()) {
    // Only ever resolve the inert fixture handle in a demo tab. A non-sentinel
    // cached handle here would be a real handle that leaked in (it cannot come
    // from a demo write, which only ever caches the sentinel); ignore it.
    if (cachedHandle && cachedHandle.name === FIXTURE_HANDLE_SENTINEL) {
      return cachedHandle;
    }
    if (readDemoIdentity(DEMO_HANDLE_FLAG_KEY) === "1") {
      cachedHandle = makeDemoHandle();
      return cachedHandle;
    }
    return null;
  }

  if (cachedHandle) {
    // Defense in depth: a non-demo tab must never adopt the fixture sentinel
    // handle, even if it leaked into the in-process cache (e.g. a demo tab
    // set it earlier in this same JS context). Scrub it and fall through to
    // the shared IDB read so the real folder handle still resolves.
    if (cachedHandle.name === FIXTURE_HANDLE_SENTINEL) {
      cachedHandle = null;
    } else {
      return cachedHandle;
    }
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

    // Defense in depth: never hand a non-demo tab the fixture sentinel
    // handle out of shared IDB (a poisoned key from an older build / a
    // racing demo tab). Report not-connected instead.
    if (handle && handle.name === FIXTURE_HANDLE_SENTINEL) {
      return null;
    }

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

/**
 * Peek at the SHARED IndexedDB main identity, bypassing the per-tab demo
 * masking that getStoredDirectoryHandle / getCurrentUser apply. Returns the
 * real folder handle name (null if absent or if the only thing stored is a
 * fixture sentinel) and the shared current user.
 *
 * The ONLY intended caller is FileSystemProvider's `?wikiCapture` shadowing
 * guard, which must answer "is a real signed-in user already present in the
 * shared store?" even from inside a fixture tab (where the normal getters
 * report the per-tab fixture identity). Do not use this for app data flow;
 * it intentionally ignores the demo isolation boundary.
 */
export async function peekSharedRealIdentity(): Promise<{
  handleName: string | null;
  currentUser: string | null;
}> {
  let currentUser: string | null = null;
  try {
    currentUser = (await get<string>(CURRENT_USER_KEY)) || null;
  } catch {
    currentUser = null;
  }

  let handleName: string | null = null;
  const db = await initDB();
  if (db) {
    try {
      const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(DIRECTORY_HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      if (handle && handle.name !== FIXTURE_HANDLE_SENTINEL) {
        handleName = handle.name;
      }
    } catch {
      handleName = null;
    } finally {
      db.close();
    }
  }

  return { handleName, currentUser };
}

export async function clearDirectoryHandle(): Promise<void> {
  cachedHandle = null;

  // Per-tab demo isolation. A demo tab only ever held a per-tab fake handle
  // flag, never the shared IDB key, so clearing it must NOT touch the shared
  // main key (that key belongs to a real-folder tab on the same origin).
  if (isDemoTab()) {
    deleteDemoIdentity(DEMO_HANDLE_FLAG_KEY);
    return;
  }

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
  // Per-tab demo isolation. The fixture user lives in this tab's
  // sessionStorage, never the shared IDB current-user key.
  if (isDemoTab()) {
    writeDemoIdentity(DEMO_CURRENT_USER_KEY, username);
    return;
  }
  try {
    await set(CURRENT_USER_KEY, username);
  } catch {
    // Ignore errors
  }
}

export async function getCurrentUser(): Promise<string | null> {
  // Per-tab demo isolation. A demo tab resolves its fixture user from its
  // own per-tab store and never reads the shared IDB current-user key.
  if (isDemoTab()) {
    return readDemoIdentity(DEMO_CURRENT_USER_KEY);
  }
  try {
    const user = (await get<string>(CURRENT_USER_KEY)) || null;
    // seq polish batch bot — removed the per-hit "Retrieved user from IndexedDB"
    // debug log. getCurrentUser resolves on every storage call (it backs
    // getCurrentUserCached), so it fired several times per page load + per
    // sequence op, spamming the console in the editor path. The higher-level
    // connect signal in file-system-context stays; this per-hit one was noise
    // (the prior comment already called it that). The error branch is kept.
    return user;
  } catch (err) {
    console.error("[indexeddb-store.getCurrentUser] Error:", err);
    return null;
  }
}

export async function storeMainUser(username: string): Promise<void> {
  // Per-tab demo isolation. The fixture main user lives in this tab's
  // sessionStorage, never the shared IDB main-user key.
  if (isDemoTab()) {
    writeDemoIdentity(DEMO_MAIN_USER_KEY, username);
    return;
  }
  try {
    await set(MAIN_USER_KEY, username);
  } catch {
    // Ignore errors
  }
}

export async function getMainUser(): Promise<string | null> {
  // Per-tab demo isolation. A demo tab resolves its fixture main user from
  // its own per-tab store and never reads the shared IDB main-user key.
  if (isDemoTab()) {
    return readDemoIdentity(DEMO_MAIN_USER_KEY);
  }
  try {
    return (await get<string>(MAIN_USER_KEY)) || null;
  } catch {
    return null;
  }
}

export async function clearCurrentUser(): Promise<void> {
  // Per-tab demo isolation. A demo tab clears its per-tab fixture user only,
  // never the shared IDB current-user key (owned by a real-folder tab).
  if (isDemoTab()) {
    deleteDemoIdentity(DEMO_CURRENT_USER_KEY);
    return;
  }
  try {
    await del(CURRENT_USER_KEY);
  } catch (err) {
    console.error("[indexeddb-store.clearCurrentUser] Error:", err);
  }
}

export async function clearMainUser(): Promise<void> {
  // Per-tab demo isolation. A demo tab clears its per-tab fixture main user
  // only, never the shared IDB main-user key (owned by a real-folder tab).
  if (isDemoTab()) {
    deleteDemoIdentity(DEMO_MAIN_USER_KEY);
    return;
  }
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
 *
 * Always drops this tab's per-tab demo identity (the fixture user + fake
 * handle flag) on the way out, so a Leave Demo can never leave the fixture
 * identity resolvable in the tab.
 */
export async function restorePreDemoStateOrClear(): Promise<boolean> {
  // Drop the per-tab fixture identity unconditionally. Done first so even if
  // a branch below early-returns, the fixture user / handle flag are gone.
  clearDemoIdentity();

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

// ── Multi-folder store (Phase A) ────────────────────────────────────────────
//
// The app historically remembered exactly ONE data folder: a single handle in
// the `handles` object store under DIRECTORY_HANDLE_KEY plus a `-meta` blob.
// Phase A adds a SET of remembered folders and an "active folder" pointer so a
// user can switch labs without re-running the OS picker each time.
//
// Storage layout (all additive, the legacy single-folder keys are untouched):
//   - `handles` object store, key `folder-handle::<id>`  -> the directory handle
//     (structured-cloneable FileSystemDirectoryHandle, NOT a path).
//   - idb-keyval key `research-os-folders`  -> RememberedFolderMeta[] (id, name,
//     lastOpenedAt). The handle is intentionally NOT duplicated here.
//   - idb-keyval key `research-os-active-folder`  -> the active folder id.
//
// IMPORTANT compatibility note: when the multi-folder flag is OFF, none of the
// app code below is exercised on the hot path (file-system-context only calls
// the multi-folder helpers behind MULTI_FOLDER_ENABLED). storeDirectoryHandle /
// getStoredDirectoryHandle continue to read and write the single legacy key, so
// a flag-off build is byte-identical to today. The flag-ON build keeps the
// legacy key in lockstep with the active folder (see the context wiring) so a
// later flag flip OFF degrades gracefully back to the last active folder.
//
// Demo tabs never participate: every multi-folder helper short-circuits in a
// demo tab exactly like the single-folder helpers do, so the fixture identity
// can never leak into the remembered set.

// LEGACY/unscoped base strings. Per-account hardening namespaces the metas and
// active-id keys by the account scope (the signing public key hex, see
// folder-account-scope.ts). With no identity unlocked the scope is null and
// these bare keys are used verbatim, so a pre-account build behaves exactly as
// before. Handles are NOT scoped: ids are globally-unique UUIDs and each scope's
// meta list controls which ids it can see, so the handle store needs no scoping.
const FOLDERS_KEY = "research-os-folders";
const ACTIVE_FOLDER_KEY = "research-os-active-folder";
const FOLDER_HANDLE_PREFIX = "folder-handle::";
// Records the scope that claimed the one-time unscoped-to-scoped inherit, so the
// pre-account folder set seeds only the FIRST signed-in account and no later
// account re-inherits it. We do not delete the unscoped keys (flag-off safety),
// so this flag is what makes the inherit one-time.
const UNSCOPED_INHERIT_CLAIMED_KEY = "research-os-folders-inherited-by";

/** The idb-keyval key for a scope's remembered-folder metas list. A null scope
 *  (no account unlocked) maps to the legacy unscoped base key. */
function foldersKey(scope: string | null): string {
  return scope ? FOLDERS_KEY + "::" + scope : FOLDERS_KEY;
}

/** The idb-keyval key for a scope's active-folder id. A null scope maps to the
 *  legacy unscoped base key. */
function activeFolderKey(scope: string | null): string {
  return scope ? ACTIVE_FOLDER_KEY + "::" + scope : ACTIVE_FOLDER_KEY;
}

/** The kind of folder a remembered entry represents, cached so the switcher can
 *  label it without opening each folder. Mirrors the per-folder user-settings
 *  identity: a SOLO folder has no lab, a LAB-HEAD folder is the head's own lab
 *  home, a LAB-MEMBER folder is the app-managed OPFS cache for a lab the account
 *  joined. Absent on legacy rows (treated as "solo" by the UI). */
export type RememberedFolderLabRole = "solo" | "head" | "member";

/** A folder the app remembers, as surfaced to the UI. The `handle` is hydrated
 *  from the `handles` object store on read; the rest is metadata persisted in
 *  idb-keyval.
 *
 *  Lab-as-folder (P1) caches the folder's per-folder lab identity (role, labId,
 *  labName) on the meta row so the folder switcher can render Solo / "X - head" /
 *  "Y - member" labels without opening each folder to read its settings.json.
 *  All three lab fields are optional and additive: a row written before this
 *  feature has none of them and the switcher treats it as solo. */
export interface RememberedFolder {
  id: string;
  name: string;
  lastOpenedAt: number;
  handle: FileSystemDirectoryHandle;
  /** Cached lab role for labeling. Absent on legacy rows (treat as "solo"). */
  labRole?: RememberedFolderLabRole;
  /** Cached lab id this folder belongs to (head or member). Absent for solo. */
  labId?: string;
  /** Cached cosmetic lab name for the switcher label. Absent when unknown. */
  labName?: string;
}

/** Persisted metadata row (no handle, the handle lives in the object store). The
 *  lab fields are optional + additive so legacy rows deserialize unchanged. */
interface RememberedFolderMeta {
  id: string;
  name: string;
  lastOpenedAt: number;
  labRole?: RememberedFolderLabRole;
  labId?: string;
  labName?: string;
}

/** Generate a stable, collision-resistant folder id. We cannot derive a sync
 *  id from a FileSystemDirectoryHandle (it exposes only the async isSameEntry),
 *  so we mint a random id once and dedupe new adds by isSameEntry against the
 *  already-remembered handles. Prefer crypto.randomUUID, fall back to a
 *  timestamp+random string for older runtimes. */
function makeFolderId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readFolderMetas(
  scope: string | null,
): Promise<RememberedFolderMeta[]> {
  try {
    const metas = (await get<RememberedFolderMeta[]>(foldersKey(scope))) ?? [];
    return Array.isArray(metas) ? metas : [];
  } catch {
    return [];
  }
}

async function writeFolderMetas(
  scope: string | null,
  metas: RememberedFolderMeta[],
): Promise<void> {
  try {
    await set(foldersKey(scope), metas);
  } catch {
    // best-effort
  }
}

/** Put a directory handle into the `handles` object store under its per-folder
 *  key. Mirrors the inline transaction style used for DIRECTORY_HANDLE_KEY. */
async function putFolderHandle(
  id: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await initDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(handle, FOLDER_HANDLE_PREFIX + id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IndexedDB errors
  } finally {
    db.close();
  }
}

async function getFolderHandle(
  id: string,
): Promise<FileSystemDirectoryHandle | null> {
  const db = await initDB();
  if (!db) return null;
  try {
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(FOLDER_HANDLE_PREFIX + id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function deleteFolderHandle(id: string): Promise<void> {
  const db = await initDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(FOLDER_HANDLE_PREFIX + id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IndexedDB errors
  } finally {
    db.close();
  }
}

/**
 * Backward-compatible migration (CRITICAL). On the first multi-folder read for
 * a given account scope, the SCOPED remembered set is empty but earlier data may
 * exist that should seed it. This runs a TWO-LEVEL migration, idempotent and
 * demo-safe, only when the scoped metas are empty.
 *
 * Level (a), unscoped to scoped inherit. When a scope is set AND the legacy
 * UNSCOPED metas are non-empty, copy them into the scoped key and copy the
 * unscoped active id into the scoped active key (best-effort). This is a
 * one-time "the first signed-in account inherits the pre-account folder set".
 * That is intentional and acceptable, the very first account on a browser
 * adopts the folders that were remembered before accounts existed. The unscoped
 * keys are NOT deleted, so a flag-off build still reads them.
 *
 * Level (b), legacy single-handle adoption. Otherwise (no unscoped metas, or no
 * scope) adopt the OLD single DIRECTORY_HANDLE_KEY handle as the active folder,
 * writing into the SCOPED keys, so a returning user does NOT lose their folder
 * or get bounced to the picker. The legacy handle key is never deleted.
 *
 * Returns true when a migration was performed.
 *
 * No-op in a demo tab (the legacy getter is masked there anyway).
 */
async function migrateLegacyFolderIfNeeded(scope: string | null): Promise<boolean> {
  if (isDemoTab()) return false;
  const metas = await readFolderMetas(scope);
  if (metas.length > 0) return false;

  // Level (a): the first signed-in account inherits the pre-account (unscoped)
  // folder set. Only when we are actually in a scope, and the unscoped registry
  // has folders to inherit. The unscoped keys are left in place for flag-off
  // safety, so this is a copy and not a move.
  if (scope !== null) {
    let claimed: string | null = null;
    try {
      claimed = (await get<string>(UNSCOPED_INHERIT_CLAIMED_KEY)) || null;
    } catch {
      claimed = null;
    }
    // Only the first account (or the same account again, idempotently) inherits.
    // Once another scope has claimed the inherit, later accounts start empty.
    if (claimed === null || claimed === scope) {
      const unscoped = await readFolderMetas(null);
      if (unscoped.length > 0) {
        await writeFolderMetas(scope, unscoped);
        try {
          const unscopedActive =
            (await get<string>(activeFolderKey(null))) || null;
          if (unscopedActive) {
            await set(activeFolderKey(scope), unscopedActive);
          }
        } catch {
          // best-effort
        }
        try {
          await set(UNSCOPED_INHERIT_CLAIMED_KEY, scope);
        } catch {
          // best-effort
        }
        return true;
      }
    }
  }

  // Level (b): adopt the legacy single DIRECTORY_HANDLE_KEY handle. Read it
  // directly from the object store. We bypass getStoredDirectoryHandle so a
  // poisoned in-process cachedHandle can't steer the migration, and so the
  // fixture sentinel is filtered out below.
  let legacy: FileSystemDirectoryHandle | null = null;
  const db = await initDB();
  if (db) {
    try {
      legacy = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(DIRECTORY_HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      legacy = null;
    } finally {
      db.close();
    }
  }
  if (!legacy) return false;
  // Never migrate a leaked fixture sentinel into the remembered set.
  if (legacy.name === FIXTURE_HANDLE_SENTINEL) return false;

  const meta = await getStoredDirectoryMeta();
  const id = makeFolderId();
  const row: RememberedFolderMeta = {
    id,
    name: legacy.name,
    lastOpenedAt: meta?.grantedAt ?? Date.now(),
  };
  await putFolderHandle(id, legacy);
  await writeFolderMetas(scope, [row]);
  try {
    await set(activeFolderKey(scope), id);
  } catch {
    // best-effort
  }
  return true;
}

/**
 * List the remembered folders, most-recently-opened first. Runs the legacy
 * migration first so a returning user's single folder always appears here.
 * Returns [] in a demo tab. Folders whose handle has gone missing from the
 * object store are skipped (defensive — a half-written entry never surfaces a
 * handle-less row to the UI).
 */
export async function listRememberedFolders(): Promise<RememberedFolder[]> {
  if (isDemoTab()) return [];
  const scope = await getFolderRegistryScope();
  await migrateLegacyFolderIfNeeded(scope);
  const metas = await readFolderMetas(scope);
  const out: RememberedFolder[] = [];
  for (const m of metas) {
    const handle = await getFolderHandle(m.id);
    if (!handle) continue;
    if (handle.name === FIXTURE_HANDLE_SENTINEL) continue;
    out.push({
      id: m.id,
      name: m.name,
      lastOpenedAt: m.lastOpenedAt,
      handle,
      // Surface the cached lab identity for switcher labeling. Spread only the
      // keys that are present so a legacy row stays shape-identical to before.
      ...(m.labRole !== undefined ? { labRole: m.labRole } : {}),
      ...(m.labId !== undefined ? { labId: m.labId } : {}),
      ...(m.labName !== undefined ? { labName: m.labName } : {}),
    });
  }
  out.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return out;
}

/** The active folder id (the remembered folder the app is currently using), or
 *  null when none is set. Runs the legacy migration first so a returning user
 *  has an active id even on the very first multi-folder load. */
export async function getActiveFolderId(): Promise<string | null> {
  if (isDemoTab()) return null;
  const scope = await getFolderRegistryScope();
  await migrateLegacyFolderIfNeeded(scope);
  try {
    return (await get<string>(activeFolderKey(scope))) || null;
  } catch {
    return null;
  }
}

/** Resolve the active folder's stored handle, or null. */
export async function getActiveFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const id = await getActiveFolderId();
  if (!id) return null;
  const handle = await getFolderHandle(id);
  if (handle && handle.name === FIXTURE_HANDLE_SENTINEL) return null;
  return handle;
}

/** Resolve a remembered folder's stored handle by id, or null. Used by the
 *  folder switcher to re-grant permission on a chosen folder without the OS
 *  picker. Returns null in a demo tab or when the handle is missing. */
export async function getRememberedFolderHandle(
  id: string,
): Promise<FileSystemDirectoryHandle | null> {
  if (isDemoTab()) return null;
  const handle = await getFolderHandle(id);
  if (handle && handle.name === FIXTURE_HANDLE_SENTINEL) return null;
  return handle;
}

/**
 * Add a freshly-picked folder to the remembered set and make it active. If an
 * existing remembered folder points at the SAME on-disk directory (isSameEntry),
 * its handle is refreshed and its lastOpenedAt bumped instead of adding a
 * duplicate. Returns the id of the active folder.
 *
 * No-op (returns "") in a demo tab.
 */
export async function rememberFolder(
  handle: FileSystemDirectoryHandle,
): Promise<string> {
  if (isDemoTab()) return "";
  if (handle.name === FIXTURE_HANDLE_SENTINEL) return "";
  const scope = await getFolderRegistryScope();
  await migrateLegacyFolderIfNeeded(scope);

  const metas = await readFolderMetas(scope);

  // Dedupe by isSameEntry against the already-remembered handles. isSameEntry
  // is the only reliable same-directory test the FSA gives us; name equality is
  // not enough (two different folders can share a name).
  let matchId: string | null = null;
  for (const m of metas) {
    const existing = await getFolderHandle(m.id);
    if (!existing) continue;
    try {
      if (
        typeof existing.isSameEntry === "function" &&
        (await existing.isSameEntry(handle))
      ) {
        matchId = m.id;
        break;
      }
    } catch {
      // isSameEntry can throw on a revoked handle; treat as not-a-match.
    }
  }

  const now = Date.now();
  let activeId: string;
  if (matchId) {
    activeId = matchId;
    await putFolderHandle(matchId, handle); // refresh to the freshly-granted handle
    const next = metas.map((m) =>
      m.id === matchId ? { ...m, name: handle.name, lastOpenedAt: now } : m,
    );
    await writeFolderMetas(scope, next);
  } else {
    activeId = makeFolderId();
    await putFolderHandle(activeId, handle);
    await writeFolderMetas(scope, [
      { id: activeId, name: handle.name, lastOpenedAt: now },
      ...metas,
    ]);
  }

  try {
    await set(activeFolderKey(scope), activeId);
  } catch {
    // best-effort
  }
  return activeId;
}

/** Lab identity to cache on a remembered-folder row for switcher labeling. */
export interface RememberedFolderLabMeta {
  labRole: RememberedFolderLabRole;
  labId?: string;
  labName?: string;
}

/**
 * Lab-as-folder (P1). Remember an app-MANAGED (OPFS) folder that the join flow
 * just provisioned for a lab, cache its lab identity for the switcher, and make
 * it active. This is the managed-folder analog of rememberFolder: it does NOT run
 * the isSameEntry dedupe (a managed OPFS folder is minted fresh by the caller and
 * keyed by labId, so there is nothing to dedupe against), and it writes the lab
 * meta fields onto the new row.
 *
 * If a managed row for the SAME labId already exists in this scope (a re-join, or
 * the OPFS folder was minted again), its handle is refreshed and its lab meta is
 * updated in place instead of adding a duplicate. Returns the active folder id.
 *
 * No-op (returns "") in a demo tab, mirroring rememberFolder.
 */
export async function rememberManagedFolder(
  handle: FileSystemDirectoryHandle,
  labMeta: RememberedFolderLabMeta,
): Promise<string> {
  if (isDemoTab()) return "";
  if (handle.name === FIXTURE_HANDLE_SENTINEL) return "";
  const scope = await getFolderRegistryScope();
  await migrateLegacyFolderIfNeeded(scope);

  const metas = await readFolderMetas(scope);
  const now = Date.now();

  // Dedupe by labId so a re-join refreshes the existing managed row rather than
  // stacking duplicates. Only managed (member/head) rows carry a labId.
  const matchId = labMeta.labId
    ? (metas.find((m) => m.labId === labMeta.labId)?.id ?? null)
    : null;

  let activeId: string;
  if (matchId) {
    activeId = matchId;
    await putFolderHandle(matchId, handle);
    const next = metas.map((m) =>
      m.id === matchId
        ? {
            ...m,
            name: handle.name,
            lastOpenedAt: now,
            labRole: labMeta.labRole,
            labId: labMeta.labId,
            labName: labMeta.labName,
          }
        : m,
    );
    await writeFolderMetas(scope, next);
  } else {
    activeId = makeFolderId();
    await putFolderHandle(activeId, handle);
    const row: RememberedFolderMeta = {
      id: activeId,
      name: handle.name,
      lastOpenedAt: now,
      labRole: labMeta.labRole,
      labId: labMeta.labId,
      labName: labMeta.labName,
    };
    await writeFolderMetas(scope, [row, ...metas]);
  }

  try {
    await set(activeFolderKey(scope), activeId);
  } catch {
    // best-effort
  }
  return activeId;
}

/**
 * Update the cached lab identity (role, labId, labName) on an already-remembered
 * folder so the switcher can relabel it without opening the folder. Used when a
 * folder's lab identity is discovered or changes after it was first remembered.
 * Pure meta update, no handle or active-pointer change. No-op in a demo tab or
 * when the id is not in the current scope.
 */
export async function setRememberedFolderLabMeta(
  id: string,
  labMeta: RememberedFolderLabMeta,
): Promise<void> {
  if (isDemoTab()) return;
  const scope = await getFolderRegistryScope();
  const metas = await readFolderMetas(scope);
  if (!metas.some((m) => m.id === id)) return;
  await writeFolderMetas(
    scope,
    metas.map((m) =>
      m.id === id
        ? {
            ...m,
            labRole: labMeta.labRole,
            labId: labMeta.labId,
            labName: labMeta.labName,
          }
        : m,
    ),
  );
}

/** Make an already-remembered folder the active one and bump its lastOpenedAt.
 *  Does NOT touch permissions (the caller re-grants); pure pointer update. */
export async function setActiveFolderId(id: string): Promise<void> {
  if (isDemoTab()) return;
  const scope = await getFolderRegistryScope();
  const metas = await readFolderMetas(scope);
  if (!metas.some((m) => m.id === id)) return;
  const now = Date.now();
  await writeFolderMetas(
    scope,
    metas.map((m) => (m.id === id ? { ...m, lastOpenedAt: now } : m)),
  );
  try {
    await set(activeFolderKey(scope), id);
  } catch {
    // best-effort
  }
}

/**
 * Remove one folder from the remembered set. Does NOT delete any data on disk
 * (it only drops the remembered handle + metadata). If the forgotten folder was
 * the active one, the active pointer is cleared (the caller decides what to do
 * next — typically fall back to the connect screen).
 */
export async function forgetRememberedFolder(id: string): Promise<void> {
  if (isDemoTab()) return;
  const scope = await getFolderRegistryScope();
  const metas = await readFolderMetas(scope);
  await writeFolderMetas(scope, metas.filter((m) => m.id !== id));
  await deleteFolderHandle(id);
  try {
    const active = (await get<string>(activeFolderKey(scope))) || null;
    if (active === id) {
      await del(activeFolderKey(scope));
    }
  } catch {
    // best-effort
  }
}

/**
 * Rename one remembered folder within the current account scope. This changes
 * only the display name in the scoped metas list. lastOpenedAt and the active
 * pointer are left untouched, and the on-disk folder is never touched. A blank
 * or whitespace-only name is a no-op so the UI can never store an empty label.
 *
 * No-op in a demo tab.
 */
export async function renameRememberedFolder(
  id: string,
  name: string,
): Promise<void> {
  if (isDemoTab()) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const scope = await getFolderRegistryScope();
  const metas = await readFolderMetas(scope);
  if (!metas.some((m) => m.id === id)) return;
  await writeFolderMetas(
    scope,
    metas.map((m) => (m.id === id ? { ...m, name: trimmed } : m)),
  );
}
