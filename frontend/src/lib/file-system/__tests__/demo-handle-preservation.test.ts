// Regression tests for the "Leave Demo wipes real-folder IndexedDB handle" bug.
//
// The bug: a user with a connected real folder (handle + currentUser +
// mainUser stored in IndexedDB) navigates to /demo, the fixture install
// overwrites IDB with a fake `name: "wiki-capture-fixture"` handle +
// `alex`, and Leave Demo then clears IDB — destroying the user's real
// folder grant. Post-reload they land on the folder picker.
//
// Fix: `installWikiCaptureFixture` now calls `backupRealHandleForDemo`
// before its IDB seed, and `<LeaveDemoModal>` calls
// `restorePreDemoStateOrClear` instead of clearing unconditionally.
//
// These tests exercise both helpers directly through the public
// indexeddb-store API, against an in-memory `indexedDB` shim and a mocked
// `idb-keyval` (the two stores the module talks to).

import { describe, expect, it, beforeEach, vi } from "vitest";

// ── In-memory idb-keyval mock ───────────────────────────────────────────────
// indexeddb-store.ts uses idb-keyval for the user-scalar keys
// (current user, main user, and the directory-handle metadata sidecar).
const kv = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => kv.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    kv.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    kv.delete(key);
  }),
}));

// ── In-memory `indexedDB` global shim ──────────────────────────────────────
// indexeddb-store.ts uses raw IndexedDB (not idb-keyval) for the directory
// handle, because Chrome serializes FileSystemDirectoryHandle objects only
// through the structured-clone path of an IDBObjectStore.put. We don't
// need real serialization in tests — the shim just keeps a Map per store
// and replays put/get/delete + transaction.oncomplete asynchronously to
// match the real API surface that the module touches.

type StoreMap = Map<string, unknown>;

function makeIndexedDBShim() {
  const stores = new Map<string, StoreMap>();

  function fakeRequest<T>(work: () => T): {
    onsuccess: ((this: unknown) => void) | null;
    onerror: ((this: unknown) => void) | null;
    result?: T;
    error?: unknown;
  } {
    const req = {
      onsuccess: null as ((this: unknown) => void) | null,
      onerror: null as ((this: unknown) => void) | null,
      result: undefined as T | undefined,
      error: undefined as unknown,
    };
    queueMicrotask(() => {
      try {
        req.result = work();
        req.onsuccess?.call(req);
      } catch (err) {
        req.error = err;
        req.onerror?.call(req);
      }
    });
    return req;
  }

  function makeStore(storeName: string) {
    if (!stores.has(storeName)) stores.set(storeName, new Map());
    const data = stores.get(storeName)!;
    return {
      put: (value: unknown, key: string) => fakeRequest(() => {
        data.set(key, value);
        return undefined;
      }),
      get: (key: string) => fakeRequest(() => data.get(key)),
      delete: (key: string) => fakeRequest(() => {
        data.delete(key);
        return undefined;
      }),
    };
  }

  function makeTransaction(_storeName: string) {
    const tx = {
      onsuccess: null as ((this: unknown) => void) | null,
      oncomplete: null as ((this: unknown) => void) | null,
      onerror: null as ((this: unknown) => void) | null,
      error: undefined as unknown,
      objectStore: (name: string) => makeStore(name),
    };
    // Schedule the completion microtask AFTER the request microtasks above
    // — this is what real IDB does (oncomplete fires after the last
    // request inside the transaction resolves). Two microtask hops is
    // sufficient because each request enqueues one of its own.
    queueMicrotask(() => {
      queueMicrotask(() => {
        try {
          tx.oncomplete?.call(tx);
        } catch (err) {
          tx.error = err;
          tx.onerror?.call(tx);
        }
      });
    });
    return tx;
  }

  function makeDB() {
    return {
      objectStoreNames: {
        contains: (name: string) => stores.has(name),
      },
      createObjectStore: (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return makeStore(name);
      },
      transaction: (storeName: string, _mode: string) => makeTransaction(storeName),
      close: () => {},
    };
  }

  const indexedDB = {
    open: (_name: string, _version: number) => {
      const req = {
        onupgradeneeded: null as ((this: unknown) => void) | null,
        onsuccess: null as ((this: unknown) => void) | null,
        onerror: null as ((this: unknown) => void) | null,
        onblocked: null as ((this: unknown) => void) | null,
        result: undefined as ReturnType<typeof makeDB> | undefined,
      };
      queueMicrotask(() => {
        const db = makeDB();
        req.result = db;
        // Fire upgrade once on the first open of a fresh DB. The shim
        // doesn't track versions; "fresh" = no `handles` store yet.
        if (!stores.has("handles")) {
          db.createObjectStore("handles");
          req.onupgradeneeded?.call(req);
        }
        req.onsuccess?.call(req);
      });
      return req;
    },
  };

  return { indexedDB, stores };
}

let shim: ReturnType<typeof makeIndexedDBShim>;

beforeEach(() => {
  // Fresh shim + fresh idb-keyval state for each test, so tests don't
  // leak the `_pre-demo-*` keys across runs.
  kv.clear();
  shim = makeIndexedDBShim();
  vi.stubGlobal("indexedDB", shim.indexedDB);
});

// ── Imports (after vi.mock is configured) ──────────────────────────────────
//
// The module-level `cachedHandle` inside indexeddb-store.ts persists
// across imports; we reset it via an explicit clear at the top of every
// test (see the helper below).

import {
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  storeCurrentUser,
  getCurrentUser,
  storeMainUser,
  getMainUser,
  clearDirectoryHandle,
  clearCurrentUser,
  clearMainUser,
  backupRealHandleForDemo,
  restorePreDemoStateOrClear,
  getPreDemoDirectoryHandle,
  getPreDemoCurrentUser,
  getPreDemoMainUser,
} from "../indexeddb-store";

/** Reset the module's cached handle + all faux-IDB state between tests. */
async function resetAllStores() {
  await clearDirectoryHandle();
  await clearCurrentUser();
  await clearMainUser();
}

// Stand-in for a real FileSystemDirectoryHandle. The shim doesn't run
// structured-clone serialization, so a plain object passes through
// `put → get` round-trips verbatim. The `name` field is the only field
// the production code reads from a stored handle.
function makeHandle(name: string): FileSystemDirectoryHandle {
  return { name, kind: "directory" } as unknown as FileSystemDirectoryHandle;
}

beforeEach(async () => {
  await resetAllStores();
});

describe("backupRealHandleForDemo", () => {
  it("Test A — backs up a real handle + users into pre-demo keys before fixture install", async () => {
    // Pre-seed IDB with the user's real-folder state.
    const realHandle = makeHandle("research-folder");
    await storeDirectoryHandle(realHandle);
    await storeCurrentUser("Grant");
    await storeMainUser("Grant");

    // Run the install-side backup.
    await backupRealHandleForDemo();

    // The backup keys now hold the real-folder state...
    const preHandle = await getPreDemoDirectoryHandle();
    expect(preHandle?.name).toBe("research-folder");
    expect(await getPreDemoCurrentUser()).toBe("Grant");
    expect(await getPreDemoMainUser()).toBe("Grant");

    // ...and the main keys still hold the real handle (the install
    // overwrites them AFTER the backup runs; the test exercises only
    // the backup helper).
    const main = await getStoredDirectoryHandle();
    expect(main?.name).toBe("research-folder");
    expect(await getCurrentUser()).toBe("Grant");
    expect(await getMainUser()).toBe("Grant");
  });

  it("Test C — does NOT write backup keys when there is no pre-existing real folder", async () => {
    // No pre-seed: IDB is empty (the true public-/demo-arrival case).
    await backupRealHandleForDemo();

    expect(await getPreDemoDirectoryHandle()).toBeNull();
    expect(await getPreDemoCurrentUser()).toBeNull();
    expect(await getPreDemoMainUser()).toBeNull();
  });

  it("Test D — double-install preserves the ORIGINAL real handle, not the fixture handle", async () => {
    // Round 1: real-folder pre-existing → backup written.
    const realHandle = makeHandle("research-folder");
    await storeDirectoryHandle(realHandle);
    await storeCurrentUser("Grant");
    await storeMainUser("Grant");
    await backupRealHandleForDemo();

    // Simulate the install side of the production flow: after backup,
    // it overwrites the main keys with the fixture handle + alex.
    const fakeHandle = makeHandle("wiki-capture-fixture");
    await storeDirectoryHandle(fakeHandle);
    await storeCurrentUser("alex");
    await storeMainUser("alex");

    // Round 2: user navigates /demo → /something → /demo, hard reload
    // re-runs the install. The current main handle is now the fake one.
    await backupRealHandleForDemo();

    // Backup still holds the ORIGINAL real handle, not the fake fixture.
    const preHandle = await getPreDemoDirectoryHandle();
    expect(preHandle?.name).toBe("research-folder");
    expect(await getPreDemoCurrentUser()).toBe("Grant");
    expect(await getPreDemoMainUser()).toBe("Grant");
  });
});

describe("restorePreDemoStateOrClear", () => {
  it("Test B — restores a backed-up real handle + users onto the main keys, then clears the backup", async () => {
    // Set up the post-install state from Test A: backup has the real
    // handle + users, main keys have the fake fixture handle + alex.
    const realHandle = makeHandle("research-folder");
    await storeDirectoryHandle(realHandle);
    await storeCurrentUser("Grant");
    await storeMainUser("Grant");
    await backupRealHandleForDemo();

    const fakeHandle = makeHandle("wiki-capture-fixture");
    await storeDirectoryHandle(fakeHandle);
    await storeCurrentUser("alex");
    await storeMainUser("alex");

    // Public-demo Leave path: restore.
    const restored = await restorePreDemoStateOrClear();

    expect(restored).toBe(true);

    // Main keys hold the original real-folder state again.
    const main = await getStoredDirectoryHandle();
    expect(main?.name).toBe("research-folder");
    expect(await getCurrentUser()).toBe("Grant");
    expect(await getMainUser()).toBe("Grant");

    // Backup keys are cleared so a stale backup doesn't cross-contaminate
    // the next demo session.
    expect(await getPreDemoDirectoryHandle()).toBeNull();
    expect(await getPreDemoCurrentUser()).toBeNull();
    expect(await getPreDemoMainUser()).toBeNull();
  });

  it("Test C (continued) — clears main keys when no backup exists (true public-demo Leave path)", async () => {
    // No pre-seed of real folder; only the fixture state exists in main.
    const fakeHandle = makeHandle("wiki-capture-fixture");
    await storeDirectoryHandle(fakeHandle);
    await storeCurrentUser("alex");
    await storeMainUser("alex");

    const restored = await restorePreDemoStateOrClear();

    expect(restored).toBe(false);
    expect(await getStoredDirectoryHandle()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
    expect(await getMainUser()).toBeNull();
    // No stale backup keys lingering.
    expect(await getPreDemoCurrentUser()).toBeNull();
    expect(await getPreDemoMainUser()).toBeNull();
  });
});
