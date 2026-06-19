// Lab-as-folder (P1): RememberedFolderMeta lab-identity caching tests.
//
// Covers the new managed-folder helpers in indexeddb-store.ts:
//   - rememberManagedFolder registers an app-managed folder, caches its lab
//     identity (labRole + labId + labName) on the meta row, and makes it active;
//   - listRememberedFolders surfaces those cached fields so the switcher can
//     label without opening each folder;
//   - a re-join (same labId) refreshes the existing managed row instead of
//     duplicating it;
//   - a head folder and a member folder coexist in one remembered set with
//     distinct labRole AND distinct labId;
//   - a plain rememberFolder row carries NO lab fields (flag-off-safe default).
//
// Reuses the same in-memory idb-keyval mock + raw-IndexedDB shim as
// multi-folder-store.test.ts (the two stores indexeddb-store talks to).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, beforeEach, vi } from "vitest";

// In-memory idb-keyval mock.
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

// In-memory `indexedDB` global shim (the `handles` object store).
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
      transaction: (storeName: string, _mode: string) =>
        makeTransaction(storeName),
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

beforeEach(() => {
  kv.clear();
  vi.stubGlobal("indexedDB", makeIndexedDBShim().indexedDB);
});

import {
  listRememberedFolders,
  getActiveFolderId,
  rememberFolder,
  rememberManagedFolder,
} from "../indexeddb-store";

function makeHandle(name: string): FileSystemDirectoryHandle {
  return {
    name,
    kind: "directory",
    isSameEntry: async () => false,
  } as unknown as FileSystemDirectoryHandle;
}

describe("rememberManagedFolder", () => {
  it("registers a managed member folder, caches its lab identity, and makes it active", async () => {
    const id = await rememberManagedFolder(makeHandle("lab-member-LAB1"), {
      labRole: "member",
      labId: "LAB1",
      labName: "Fungal Lab",
    });

    const folders = await listRememberedFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({
      id,
      name: "lab-member-LAB1",
      labRole: "member",
      labId: "LAB1",
      labName: "Fungal Lab",
    });
    expect(await getActiveFolderId()).toBe(id);
  });

  it("refreshes the existing managed row on a re-join (same labId), not a duplicate", async () => {
    const first = await rememberManagedFolder(makeHandle("lab-member-LAB1"), {
      labRole: "member",
      labId: "LAB1",
      labName: "Old Name",
    });
    const second = await rememberManagedFolder(makeHandle("lab-member-LAB1"), {
      labRole: "member",
      labId: "LAB1",
      labName: "New Name",
    });

    expect(second).toBe(first);
    const folders = await listRememberedFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].labName).toBe("New Name");
  });

  it("does not collide a managed folder with a plain remembered folder", async () => {
    await rememberFolder(makeHandle("my-solo-folder"));
    const managedId = await rememberManagedFolder(
      makeHandle("lab-member-LAB2"),
      { labRole: "member", labId: "LAB2", labName: "Gluck Lab" },
    );

    const folders = await listRememberedFolders();
    expect(folders).toHaveLength(2);
    const managed = folders.find((f) => f.id === managedId)!;
    expect(managed.labRole).toBe("member");
    const solo = folders.find((f) => f.name === "my-solo-folder")!;
    // A plain remembered folder carries NO cached lab fields (flag-off default).
    expect(solo.labRole).toBeUndefined();
    expect(solo.labId).toBeUndefined();
    expect(solo.labName).toBeUndefined();
  });

  it("lets a head folder and a member folder coexist with distinct labRole and labId", async () => {
    // A lab head who heads their own lab AND has joined another lab as a member
    // ends up with two managed rows. The Emile-bug fix means joining the member
    // lab provisions a fresh member folder rather than overwriting the head
    // folder, so both identities coexist with distinct role AND distinct labId.
    const headId = await rememberManagedFolder(makeHandle("my-own-lab"), {
      labRole: "head",
      labId: "LAB_HEAD",
      labName: "Nickles Lab",
    });
    const memberId = await rememberManagedFolder(makeHandle("joined-lab"), {
      labRole: "member",
      labId: "LAB_MEMBER",
      labName: "Gluck Lab",
    });

    const folders = await listRememberedFolders();
    expect(folders).toHaveLength(2);
    const head = folders.find((f) => f.id === headId)!;
    const member = folders.find((f) => f.id === memberId)!;
    expect(head.labRole).toBe("head");
    expect(head.labId).toBe("LAB_HEAD");
    expect(member.labRole).toBe("member");
    expect(member.labId).toBe("LAB_MEMBER");
    // Distinct role AND distinct labId, simultaneously, in one remembered set.
    expect(head.labRole).not.toBe(member.labRole);
    expect(head.labId).not.toBe(member.labId);
  });
});
