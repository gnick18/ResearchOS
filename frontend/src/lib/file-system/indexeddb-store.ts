import { get, set, del } from "idb-keyval";

const DIRECTORY_HANDLE_KEY = "research-os-directory-handle";
const CURRENT_USER_KEY = "research-os-current-user";
const MAIN_USER_KEY = "research-os-main-user";
const STORE_NAME = "handles";
const DB_NAME = "research-os-fsa";

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
