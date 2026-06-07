// Regression tests for the cross-tab demo poisoning bug.
//
// THE BUG (the chain that wrote a stray empty `users/alex` folder into a
// user's REAL research folder): `installWikiCaptureFixture` seeded the demo
// identity (`alex` + the inert `wiki-capture-fixture` handle) into the
// IndexedDB main keys, which are SHARED across every same-origin tab. The
// demo *flag* is per-tab (sessionStorage), but the identity was shared, so a
// real-folder tab could pick up the fixture `alex` + fake handle and a later
// hydrate could materialize a phantom `users/alex` directory.
//
// THE FIX (this file is the "never again" contract):
//   - indexeddb-store routes the demo identity (current user, main user, fake
//     handle) into a PER-TAB sessionStorage store when this tab is a demo /
//     wiki-capture tab, never the shared IDB main keys.
//   - the getters resolve the fixture identity only in a demo tab; a normal
//     tab never sees `alex` / the fixture sentinel handle from the shared
//     store (defense in depth: a leaked sentinel handle is treated as
//     not-connected).
//
// These run in the node-env project (`*.test.ts`). `window` is undefined by
// default, so we stub a per-test sessionStorage + location to simulate the
// demo tab vs. the real tab on the same origin. The shared IndexedDB +
// idb-keyval shims mirror the demo-handle-preservation suite.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// ── In-memory idb-keyval mock (the SHARED scalar store) ─────────────────────
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

// ── In-memory indexedDB global shim (the SHARED handle store) ────────────────
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

// ── Per-tab sessionStorage + location shim (the PER-TAB store) ───────────────
// Each "tab" gets its own sessionStorage Map. The shared IDB shims above are
// shared across tabs (same origin); sessionStorage is not.
function makeSessionStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

/** Make `window` look like a particular tab: a real tab (default) or a demo
 *  tab (sets the per-tab demo sticky flag + /demo path). */
function enterTab(opts: { demo?: boolean } = {}) {
  const sessionStorage = makeSessionStorage();
  const win = {
    sessionStorage,
    location: {
      pathname: opts.demo ? "/demo" : "/",
      search: "",
      hostname: "localhost",
    },
  };
  vi.stubGlobal("window", win);
  if (opts.demo) {
    // Mirror markDemoMode() — the sticky per-tab demo flag.
    sessionStorage.setItem("researchos:demo-mode", "1");
  }
  return win;
}

function leaveTab() {
  vi.stubGlobal("window", undefined);
}

let shim: ReturnType<typeof makeIndexedDBShim>;
beforeEach(() => {
  kv.clear();
  shim = makeIndexedDBShim();
  vi.stubGlobal("indexedDB", shim.indexedDB);
  // Default: a real tab (no demo flag). Individual tests switch tabs.
  leaveTab();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import {
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  storeCurrentUser,
  getCurrentUser,
  storeMainUser,
  getMainUser,
  restorePreDemoStateOrClear,
  backupRealHandleForDemo,
  peekSharedRealIdentity,
} from "../indexeddb-store";

function makeHandle(name: string): FileSystemDirectoryHandle {
  return { name, kind: "directory" } as unknown as FileSystemDirectoryHandle;
}

/** Read the raw SHARED stores directly, the way a *second* tab on the same
 *  origin would. Bypasses any per-tab masking entirely. */
function readSharedCurrentUser(): unknown {
  return kv.get("research-os-current-user");
}
function readSharedMainUser(): unknown {
  return kv.get("research-os-main-user");
}
function readSharedHandle(): unknown {
  return shim.stores.get("handles")?.get("research-os-directory-handle");
}

// The exact sequence installWikiCaptureFixture performs to seed the fixture
// identity (wiki-capture-mock.ts ~lines 771-779).
async function seedFixtureIdentityLikeInstall() {
  await backupRealHandleForDemo();
  await storeCurrentUser("alex");
  await storeMainUser("alex");
  await storeDirectoryHandle(makeHandle("wiki-capture-fixture"));
}

describe("demo identity never poisons the shared IndexedDB main keys", () => {
  it("seeding the fixture identity in a demo tab writes NOTHING to the shared current-user / main-user / handle keys", async () => {
    enterTab({ demo: true });

    await seedFixtureIdentityLikeInstall();

    // A second / real tab reading the SHARED stores must NOT see the fixture.
    expect(readSharedCurrentUser()).toBeUndefined();
    expect(readSharedMainUser()).toBeUndefined();
    expect(readSharedHandle()).toBeUndefined();

    // But THIS demo tab still resolves the fixture identity (demo keeps
    // working exactly as before).
    expect(await getCurrentUser()).toBe("alex");
    expect(await getMainUser()).toBe("alex");
    const h = await getStoredDirectoryHandle();
    expect(h?.name).toBe("wiki-capture-fixture");
  });

  it("a real-folder tab is untouched when a demo tab seeds the fixture identity (no cross-tab leak)", async () => {
    // Real tab connects a real folder first.
    enterTab({ demo: false });
    await storeDirectoryHandle(makeHandle("research-folder"));
    await storeCurrentUser("Grant");
    await storeMainUser("Grant");

    // Demo tab opens on the same origin and seeds its fixture identity.
    enterTab({ demo: true });
    await seedFixtureIdentityLikeInstall();

    // Back in the real tab: the real identity is intact, NOT overwritten by
    // the demo's `alex` / fixture handle.
    enterTab({ demo: false });
    // The in-process cache may still hold the demo handle from the last
    // storeDirectoryHandle in the demo tab; a real tab must scrub the
    // sentinel and fall back to the shared real handle.
    const handle = await getStoredDirectoryHandle();
    expect(handle?.name).toBe("research-folder");
    expect(await getCurrentUser()).toBe("Grant");
    expect(await getMainUser()).toBe("Grant");

    // The shared stores never held the fixture values.
    expect(readSharedCurrentUser()).toBe("Grant");
    expect(readSharedMainUser()).toBe("Grant");
    expect((readSharedHandle() as FileSystemDirectoryHandle).name).toBe(
      "research-folder",
    );
  });
});

describe("defense in depth: a non-demo tab never adopts a fixture sentinel handle", () => {
  it("getStoredDirectoryHandle returns null for a leaked `wiki-capture-fixture` handle in shared IDB", async () => {
    // Simulate a poisoned shared key from an older build: a sentinel handle
    // sits in shared IDB. Seed it through the public API from a non-demo tab
    // (which writes the shared key), then read it from a non-demo tab.
    enterTab({ demo: false });
    await storeDirectoryHandle(makeHandle("wiki-capture-fixture"));
    // Confirm it is physically in the shared store.
    expect((readSharedHandle() as FileSystemDirectoryHandle).name).toBe(
      "wiki-capture-fixture",
    );

    const handle = await getStoredDirectoryHandle();
    expect(handle).toBeNull();
  });

  it("peekSharedRealIdentity ignores a fixture sentinel handle name", async () => {
    enterTab({ demo: false });
    await storeDirectoryHandle(makeHandle("wiki-capture-fixture"));
    kv.set("research-os-current-user", "alex");

    const { handleName } = await peekSharedRealIdentity();
    expect(handleName).toBeNull();
  });
});

describe("Leave Demo from a demo tab does not touch the shared real-folder keys", () => {
  it("a real-folder tab's shared identity survives a Leave Demo run in a demo tab", async () => {
    // Real folder lives in the shared store.
    enterTab({ demo: false });
    await storeDirectoryHandle(makeHandle("research-folder"));
    await storeCurrentUser("Grant");
    await storeMainUser("Grant");

    // Demo tab seeds + then leaves.
    enterTab({ demo: true });
    await seedFixtureIdentityLikeInstall();
    const restored = await restorePreDemoStateOrClear();
    // No pre-demo backup was written (the demo never clobbered the shared
    // keys, so there was nothing to back up), so this is the clear branch.
    expect(restored).toBe(false);

    // Per-tab fixture identity is gone in the demo tab.
    expect(await getCurrentUser()).toBeNull();

    // Crucially: the real tab's shared identity is still intact.
    enterTab({ demo: false });
    expect(readSharedCurrentUser()).toBe("Grant");
    expect(readSharedMainUser()).toBe("Grant");
    expect((readSharedHandle() as FileSystemDirectoryHandle).name).toBe(
      "research-folder",
    );
  });
});
