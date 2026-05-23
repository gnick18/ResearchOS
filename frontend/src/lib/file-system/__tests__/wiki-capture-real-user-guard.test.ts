// Wave 1 sticky-flag hygiene: real-user shadowing guard contract.
//
// Bug (break-bot B P0-2): on the dev / wiki-capture host, pasting
// `?wikiCapture=1` mid-tour silently swaps a real signed-in user's
// session for the in-memory fixture mock. The hostname gate inside
// `getWikiCaptureVariant()` already keeps true production safe; this
// guard is the dev-side belt-and-suspenders.
//
// The guard lives in `file-system-context.tsx`. Its predicate is:
//
//     captureVariant != null && !demoMode && existingHandle != null &&
//     existingHandle.name !== "wiki-capture-fixture" && existingUser != null
//
// This file exercises that predicate against the same in-memory
// indexeddb-store / idb-keyval shim used by demo-handle-preservation
// tests. We can't easily mount FileSystemProvider in node-env without
// dragging the whole React tree in, so we replicate the predicate here
// and assert against the canonical inputs.

import { describe, expect, it, beforeEach, vi } from "vitest";

// ── In-memory idb-keyval mock ──────────────────────────────────────────────
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

// ── In-memory indexedDB global shim (same pattern as demo-handle-preservation) ──
type StoreMap = Map<string, unknown>;
function makeIndexedDBShim() {
  const stores = new Map<string, StoreMap>();
  function fakeRequest<T>(work: () => T) {
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
      put: (value: unknown, key: string) =>
        fakeRequest(() => {
          data.set(key, value);
          return undefined;
        }),
      get: (key: string) => fakeRequest(() => data.get(key)),
      delete: (key: string) =>
        fakeRequest(() => {
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
      objectStoreNames: { contains: (name: string) => stores.has(name) },
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
  kv.clear();
  shim = makeIndexedDBShim();
  vi.stubGlobal("indexedDB", shim.indexedDB);
});

import {
  storeDirectoryHandle,
  storeCurrentUser,
  clearDirectoryHandle,
  clearCurrentUser,
  clearMainUser,
  getStoredDirectoryHandle,
  getCurrentUser,
} from "../indexeddb-store";

async function resetAllStores() {
  await clearDirectoryHandle();
  await clearCurrentUser();
  await clearMainUser();
}

function makeHandle(name: string): FileSystemDirectoryHandle {
  return { name, kind: "directory" } as unknown as FileSystemDirectoryHandle;
}

beforeEach(async () => {
  await resetAllStores();
});

/**
 * Replica of the guard predicate from FileSystemProvider.initialize().
 * Kept in sync with the production code; if you change the predicate
 * there, change it here too. Pulled into a helper so we can unit-test
 * the decision without mounting the full provider tree.
 */
async function shouldRefuseWikiCaptureInstall(): Promise<boolean> {
  const [existingHandle, existingUser] = await Promise.all([
    getStoredDirectoryHandle(),
    getCurrentUser(),
  ]);
  return (
    !!existingHandle &&
    existingHandle.name !== "wiki-capture-fixture" &&
    !!existingUser
  );
}

describe("wiki-capture real-user shadowing guard predicate", () => {
  it("refuses install when a real folder + real user are signed in", async () => {
    await storeDirectoryHandle(makeHandle("research-folder"));
    await storeCurrentUser("Grant");

    expect(await shouldRefuseWikiCaptureInstall()).toBe(true);
  });

  it("ALLOWS install when no folder is connected at all (fresh dev profile)", async () => {
    // Nothing seeded.
    expect(await shouldRefuseWikiCaptureInstall()).toBe(false);
  });

  it("ALLOWS install when handle is the fixture sentinel (already in capture mode)", async () => {
    // Sentinel name = repeat-install scenario, no real user being
    // shadowed.
    await storeDirectoryHandle(makeHandle("wiki-capture-fixture"));
    await storeCurrentUser("alex");

    expect(await shouldRefuseWikiCaptureInstall()).toBe(false);
  });

  it("ALLOWS install when handle exists but no user is picked yet (folder-connected, on user-picker)", async () => {
    // A real folder but no chosen user is the user-picker screen. The
    // real-user-shadowing risk doesn't apply: there's no live session
    // for the capture mock to silently take over.
    await storeDirectoryHandle(makeHandle("research-folder"));
    // currentUser intentionally left null.

    expect(await shouldRefuseWikiCaptureInstall()).toBe(false);
  });

  it("ALLOWS install when only a current user exists with no handle (impossible / corrupt state, fail-open)", async () => {
    // Defensive: if the IDB state is mismatched (user without handle),
    // we'd rather honor the URL flag than block on a corrupt entry.
    await storeCurrentUser("Grant");

    expect(await shouldRefuseWikiCaptureInstall()).toBe(false);
  });
});
