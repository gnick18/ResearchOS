// Multi-folder store tests (Phase A, account/folder/identity redesign).
//
// Covers the new remembered-folders API in indexeddb-store.ts and, most
// importantly, the OLD -> NEW migration: a returning user who has only the
// legacy single DIRECTORY_HANDLE_KEY handle must have it adopted as the ACTIVE
// folder in the new store, with no loss and no bounce.
//
// Reuses the same in-memory idb-keyval mock + raw-IndexedDB shim as
// demo-handle-preservation.test.ts (the two stores indexeddb-store talks to).
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  setSessionIdentity,
  clearSessionIdentity,
} from "@/lib/sharing/identity/session-key";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import { generateDeviceSalt } from "@/lib/sharing/identity/backup";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";

// ── In-memory idb-keyval mock ───────────────────────────────────────────────
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
  getStoredDirectoryHandle,
  clearDirectoryHandle,
  clearCurrentUser,
  clearMainUser,
  listRememberedFolders,
  getActiveFolderId,
  getActiveFolderHandle,
  getRememberedFolderHandle,
  rememberFolder,
  setActiveFolderId,
  forgetRememberedFolder,
  renameRememberedFolder,
} from "../indexeddb-store";

async function resetAllStores() {
  await clearDirectoryHandle();
  await clearCurrentUser();
  await clearMainUser();
}

// A stand-in handle. The shim does not run structured-clone, so a plain object
// round-trips verbatim. `isSameEntry` is provided so dedupe logic can exercise
// it; two handles are "the same entry" when they share an `entryId`.
function makeHandle(name: string, entryId?: string): FileSystemDirectoryHandle {
  const id = entryId ?? name;
  return {
    name,
    kind: "directory",
    isSameEntry: async (other: { name?: string } & Record<string, unknown>) =>
      (other as { __entryId?: string }).__entryId === id,
    __entryId: id,
  } as unknown as FileSystemDirectoryHandle;
}

beforeEach(async () => {
  await resetAllStores();
});

// Each call mints a fresh, distinct identity. The registry scope is derived from
// the signing public key hex, so two of these drive two disjoint scopes.
function makeIdentity(): StoredIdentity {
  return { keys: generateIdentityKeys(), deviceSalt: generateDeviceSalt() };
}

// Clear the session scope after every case so a leaked identity never carries a
// scope into the next test.
afterEach(() => {
  clearSessionIdentity();
});

describe("OLD -> NEW migration (CRITICAL)", () => {
  it("adopts the legacy single folder as the active folder on first multi-folder read", async () => {
    // A returning user: only the legacy single DIRECTORY_HANDLE_KEY exists, set
    // by the pre-multi-folder build (with its -meta sidecar).
    const legacy = makeHandle("my-research");
    await storeDirectoryHandle(legacy);

    // First multi-folder read. The migration runs lazily here.
    const folders = await listRememberedFolders();

    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("my-research");
    expect(folders[0].id).toBeTruthy();

    // It is the ACTIVE folder, and its handle resolves.
    const activeId = await getActiveFolderId();
    expect(activeId).toBe(folders[0].id);
    const activeHandle = await getActiveFolderHandle();
    expect(activeHandle?.name).toBe("my-research");

    // The legacy key is NOT deleted (flag-off builds still read it).
    const stillLegacy = await getStoredDirectoryHandle();
    expect(stillLegacy?.name).toBe("my-research");
  });

  it("is idempotent: a second read does not duplicate the migrated folder", async () => {
    await storeDirectoryHandle(makeHandle("my-research"));
    const first = await listRememberedFolders();
    const second = await listRememberedFolders();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
  });

  it("does not migrate the demo fixture sentinel handle", async () => {
    // A leaked fixture handle must never become a remembered folder.
    await storeDirectoryHandle(makeHandle("wiki-capture-fixture"));
    const folders = await listRememberedFolders();
    expect(folders).toHaveLength(0);
    expect(await getActiveFolderId()).toBeNull();
  });

  it("no legacy handle means an empty set and no active folder", async () => {
    const folders = await listRememberedFolders();
    expect(folders).toHaveLength(0);
    expect(await getActiveFolderId()).toBeNull();
  });
});

describe("rememberFolder", () => {
  it("adds a freshly-picked folder as active alongside the migrated one", async () => {
    // Migrate a legacy folder, then add a second.
    await storeDirectoryHandle(makeHandle("folder-a", "a"));
    await listRememberedFolders(); // trigger migration

    const second = makeHandle("folder-b", "b");
    const newId = await rememberFolder(second);

    const folders = await listRememberedFolders();
    expect(folders.map((f) => f.name).sort()).toEqual(["folder-a", "folder-b"]);
    expect(await getActiveFolderId()).toBe(newId);
    expect((await getActiveFolderHandle())?.name).toBe("folder-b");
  });

  it("dedupes by isSameEntry instead of adding a duplicate row", async () => {
    const a1 = makeHandle("folder-a", "a");
    const id1 = await rememberFolder(a1);

    // Re-pick the SAME on-disk directory (same entryId, fresh handle object).
    const a2 = makeHandle("folder-a", "a");
    const id2 = await rememberFolder(a2);

    expect(id2).toBe(id1);
    const folders = await listRememberedFolders();
    expect(folders).toHaveLength(1);
  });

  it("ignores the fixture sentinel handle", async () => {
    const id = await rememberFolder(makeHandle("wiki-capture-fixture"));
    expect(id).toBe("");
    expect(await listRememberedFolders()).toHaveLength(0);
  });
});

describe("setActiveFolderId / getRememberedFolderHandle", () => {
  it("switches the active pointer between two remembered folders", async () => {
    const idA = await rememberFolder(makeHandle("folder-a", "a"));
    const idB = await rememberFolder(makeHandle("folder-b", "b"));
    expect(await getActiveFolderId()).toBe(idB);

    await setActiveFolderId(idA);
    expect(await getActiveFolderId()).toBe(idA);
    expect((await getActiveFolderHandle())?.name).toBe("folder-a");

    // The non-active handle is still resolvable by id (for the switcher).
    expect((await getRememberedFolderHandle(idB))?.name).toBe("folder-b");
  });

  it("setActiveFolderId is a no-op for an unknown id", async () => {
    const idA = await rememberFolder(makeHandle("folder-a", "a"));
    await setActiveFolderId("does-not-exist");
    expect(await getActiveFolderId()).toBe(idA);
  });
});

describe("forgetRememberedFolder", () => {
  it("removes one folder and clears the active pointer when it was active", async () => {
    await rememberFolder(makeHandle("folder-a", "a"));
    const idB = await rememberFolder(makeHandle("folder-b", "b"));
    expect(await getActiveFolderId()).toBe(idB);

    await forgetRememberedFolder(idB);

    const folders = await listRememberedFolders();
    expect(folders.map((f) => f.name)).toEqual(["folder-a"]);
    // Active pointer cleared because the forgotten folder was active.
    expect(await getActiveFolderId()).toBeNull();
    // Its handle is gone from the object store.
    expect(await getRememberedFolderHandle(idB)).toBeNull();
  });

  it("forgetting a non-active folder leaves the active pointer intact", async () => {
    const idA = await rememberFolder(makeHandle("folder-a", "a"));
    const idB = await rememberFolder(makeHandle("folder-b", "b"));
    expect(await getActiveFolderId()).toBe(idB);

    await forgetRememberedFolder(idA);

    expect(await getActiveFolderId()).toBe(idB);
    const folders = await listRememberedFolders();
    expect(folders.map((f) => f.name)).toEqual(["folder-b"]);
  });
});

describe("recent-ordering", () => {
  it("lists most-recently-opened first", async () => {
    // Drive Date.now forward so each lastOpenedAt stamp is distinct and the
    // sort is deterministic (real usage spans many ms between opens).
    let clock = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const idA = await rememberFolder(makeHandle("folder-a", "a"));
      clock += 1000;
      await rememberFolder(makeHandle("folder-b", "b"));
      clock += 1000;
      // Re-activate A so it becomes the most-recent.
      await setActiveFolderId(idA);

      const folders = await listRememberedFolders();
      expect(folders[0].name).toBe("folder-a");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("per-account scoping", () => {
  it("two identities see disjoint remembered sets and active ids", async () => {
    const a = makeIdentity();
    const b = makeIdentity();

    // Account A remembers a folder.
    setSessionIdentity(a);
    const idA = await rememberFolder(makeHandle("a-folder", "a"));
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual([
      "a-folder",
    ]);
    expect(await getActiveFolderId()).toBe(idA);

    // Switch to account B. It starts empty and has no active folder.
    setSessionIdentity(b);
    expect(await listRememberedFolders()).toHaveLength(0);
    expect(await getActiveFolderId()).toBeNull();

    // B remembers its own folder, which A must not see.
    const idB = await rememberFolder(makeHandle("b-folder", "b"));
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual([
      "b-folder",
    ]);
    expect(await getActiveFolderId()).toBe(idB);

    // Back to A. Its set and active id are intact and untouched by B.
    setSessionIdentity(a);
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual([
      "a-folder",
    ]);
    expect(await getActiveFolderId()).toBe(idA);
  });

  it("the first signed-in account inherits the pre-account unscoped set, later accounts do not", async () => {
    // No identity yet: seed the legacy unscoped registry the way a pre-account
    // build would have left it.
    const legacyId = await rememberFolder(makeHandle("pre-account", "pre"));
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual([
      "pre-account",
    ]);

    // First account A signs in and inherits the unscoped folder once.
    const a = makeIdentity();
    setSessionIdentity(a);
    const inherited = await listRememberedFolders();
    expect(inherited.map((f) => f.name)).toEqual(["pre-account"]);
    expect(await getActiveFolderId()).toBe(legacyId);

    // A second account B does NOT also inherit. The inherit is a one-time seed
    // for the first account only.
    const b = makeIdentity();
    setSessionIdentity(b);
    expect(await listRememberedFolders()).toHaveLength(0);
    expect(await getActiveFolderId()).toBeNull();
  });

  it("renameRememberedFolder changes the name within the active scope only", async () => {
    const a = makeIdentity();
    const b = makeIdentity();

    setSessionIdentity(a);
    const idA = await rememberFolder(makeHandle("a-folder", "a"));

    setSessionIdentity(b);
    await rememberFolder(makeHandle("b-folder", "b"));

    // Rename under A.
    setSessionIdentity(a);
    await renameRememberedFolder(idA, "Renamed In A");
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual([
      "Renamed In A",
    ]);

    // B is unaffected.
    setSessionIdentity(b);
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual([
      "b-folder",
    ]);

    // A blank rename is a no-op.
    setSessionIdentity(a);
    await renameRememberedFolder(idA, "   ");
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual([
      "Renamed In A",
    ]);
  });

  it("with no identity, behavior is the legacy unscoped path", async () => {
    // Sanity: no session set means scope is null and the bare keys are used,
    // exactly the pre-account behavior the other suites already exercise.
    const id = await rememberFolder(makeHandle("solo", "solo"));
    expect((await listRememberedFolders()).map((f) => f.name)).toEqual(["solo"]);
    expect(await getActiveFolderId()).toBe(id);
  });
});
