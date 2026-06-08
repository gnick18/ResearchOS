import { get, set, del } from "idb-keyval";
import { forgetAllTelegramTokenCache } from "@/lib/telegram/telegram-token-cache";

const DIRECTORY_HANDLE_KEY = "research-os-directory-handle";
const CURRENT_USER_KEY = "research-os-current-user";
const MAIN_USER_KEY = "research-os-main-user";
const STORE_NAME = "handles";
const CACHE_STORE_NAME = "file-cache";
const DB_NAME = "research-os-fsa";
const DB_VERSION = 2;

export interface CacheEntry {
  key: string;          // `${folderName}::${path}`
  lastModified: number; // File.lastModified at cache time
  data: unknown;        // parsed JSON object or string
  kind: "json" | "text";
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

  // SENSITIVE: bot-token cache lives at SECURITY_AUDIT.md §1.3. Cache scope
  // follows disk scope, so leaving the folder (disconnect / folder switch)
  // wipes every cached token tied to that folder name before the handle +
  // meta themselves disappear. The folder name is the cache's scope key,
  // so we must read it BEFORE deleting the meta entry below.
  try {
    const meta = await get<{ name: string; grantedAt: number }>(
      DIRECTORY_HANDLE_KEY + "-meta",
    );
    if (meta?.name) {
      await forgetAllTelegramTokenCache(meta.name);
    }
  } catch {
    // Ignore: cache wipe is best-effort. A failure here can't leave the
    // user worse off than the pre-cache behavior; the disk side still wins.
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
