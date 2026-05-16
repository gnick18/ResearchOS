// Tests for constraint [5] — when `clearDirectoryHandle` runs (disconnect
// or folder switch), it must wipe every IDB telegram-token cache entry
// scoped to the folder that's about to be released. Cache scope follows
// disk scope. The wiring goes through `forgetAllTelegramTokenCache(folder)`
// per the security manager's tightening #2.

import { describe, expect, it, beforeEach, vi } from "vitest";

// In-memory idb-keyval mock, shared with the telegram-token-cache module.
const kv = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => kv.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    kv.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    kv.delete(key);
  }),
  keys: vi.fn(async () => Array.from(kv.keys())),
}));

// Raw-IDB shim for the FSA handle. Lifted directly from
// demo-handle-preservation.test.ts so this test exercises the same
// transaction-completion semantics the production code relies on.
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
  return { indexedDB };
}

beforeEach(() => {
  kv.clear();
  const shim = makeIndexedDBShim();
  vi.stubGlobal("indexedDB", shim.indexedDB);
});

import {
  storeDirectoryHandle,
  clearDirectoryHandle,
} from "../indexeddb-store";
import {
  writeTelegramTokenCache,
  readTelegramTokenCache,
} from "@/lib/telegram/telegram-token-cache";

function makeHandle(name: string): FileSystemDirectoryHandle {
  return { name, kind: "directory" } as unknown as FileSystemDirectoryHandle;
}

describe("clearDirectoryHandle — constraint [5] folder-scoped cache wipe", () => {
  it("wipes ALL telegram-token cache entries for the released folder", async () => {
    const handle = makeHandle("lab-folder");
    await storeDirectoryHandle(handle); // writes the -meta key with name: 'lab-folder'

    // Plant cache entries for two users in this folder.
    await writeTelegramTokenCache("lab-folder", "alice", {
      botToken: "111:aaa",
      chatId: 1,
      botUsername: "alice_bot",
    });
    await writeTelegramTokenCache("lab-folder", "bob", {
      botToken: "222:bbb",
      chatId: 2,
      botUsername: "bob_bot",
    });

    // Sanity: cache is present.
    expect(await readTelegramTokenCache("lab-folder", "alice")).not.toBeNull();
    expect(await readTelegramTokenCache("lab-folder", "bob")).not.toBeNull();

    await clearDirectoryHandle();

    // Constraint [5]: both entries are gone.
    expect(await readTelegramTokenCache("lab-folder", "alice")).toBeNull();
    expect(await readTelegramTokenCache("lab-folder", "bob")).toBeNull();
  });

  it("does NOT touch cache entries scoped to a DIFFERENT folder", async () => {
    const handle = makeHandle("lab-folder");
    await storeDirectoryHandle(handle);

    await writeTelegramTokenCache("lab-folder", "alice", {
      botToken: "111:aaa",
      chatId: 1,
      botUsername: "alice_bot",
    });
    await writeTelegramTokenCache("other-folder", "alice", {
      botToken: "999:zzz",
      chatId: 9,
      botUsername: "other_bot",
    });

    await clearDirectoryHandle();

    expect(await readTelegramTokenCache("lab-folder", "alice")).toBeNull();
    expect(await readTelegramTokenCache("other-folder", "alice")).not.toBeNull();
  });

  it("is a no-op on the cache when no folder meta is stored", async () => {
    // No storeDirectoryHandle call — meta is missing.
    // Plant a stray entry (could exist from a previous folder that we
    // can't currently scope-name). The wipe doesn't know which folder
    // to target so it leaves it alone — safer than guessing.
    await writeTelegramTokenCache("ghost-folder", "alice", {
      botToken: "111:aaa",
      chatId: 1,
      botUsername: "alice_bot",
    });

    await clearDirectoryHandle();

    expect(await readTelegramTokenCache("ghost-folder", "alice")).not.toBeNull();
  });
});
