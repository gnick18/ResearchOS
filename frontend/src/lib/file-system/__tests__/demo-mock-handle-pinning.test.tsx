// @vitest-environment jsdom
//
// Regression test locking commit fa6e72a76: in demo / wiki-capture fixture
// mode, a real-folder write must be structurally impossible.
//
// THE BUG (2026-06-07, stray real users/alex): entering /demo from a tab that
// already had a real folder connected left fileService.directoryHandle holding
// the REAL handle. The getter overrides hid it, but an un-overridden mutation
// method (deleteDirectory) read the private field directly and would walk the
// real folder.
//
// THE FIX pins the private directoryHandle field to the inert
// `wiki-capture-fixture` stand-in AND overrides deleteDirectory to operate
// in-memory only. This test installs the real fixture and asserts both.
//
// jsdom is required because installWikiCaptureFixture reads window.location /
// sessionStorage. The IndexedDB + idb-keyval + fetch shims mirror the
// wiki-capture-history-text suite; the demo-asset fetches are best-effort so a
// 404 stub just leaves those blobs unseeded (irrelevant here).

import { describe, expect, it, beforeAll, vi } from "vitest";

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

// ── In-memory indexedDB global shim ─────────────────────────────────────────
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
  function makeTransaction() {
    const tx = {
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
      transaction: () => makeTransaction(),
      close: () => {},
    };
  }
  return {
    open: () => {
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
}

import { fileService } from "../file-service";
import { installWikiCaptureFixture, markDemoMode } from "../wiki-capture-mock";

beforeAll(async () => {
  vi.stubGlobal("indexedDB", makeIndexedDBShim());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
  );
  // Mark this tab as a demo tab so the per-tab identity routing engages, the
  // way /demo does in production.
  markDemoMode();
  await installWikiCaptureFixture({ signIn: true, fixtureUser: "alex" });
});

describe("demo mock pins the directory handle (fa6e72a76)", () => {
  it("pins the private directoryHandle field to the inert fixture stand-in", () => {
    const svc = fileService as unknown as Record<string, unknown>;
    const pinned = svc.directoryHandle as FileSystemDirectoryHandle | undefined;
    expect(pinned).toBeTruthy();
    expect(pinned?.name).toBe("wiki-capture-fixture");
  });

  it("getDirectoryHandle returns the fixture stand-in, never a real handle", () => {
    const svc = fileService as unknown as {
      getDirectoryHandle: () => FileSystemDirectoryHandle;
    };
    expect(svc.getDirectoryHandle().name).toBe("wiki-capture-fixture");
  });

  it("the fixture stand-in has no removeEntry / values, so any missed mutation throws harmlessly instead of walking a real folder", () => {
    const svc = fileService as unknown as Record<string, unknown>;
    const pinned = svc.directoryHandle as unknown as Record<string, unknown>;
    expect(typeof pinned.removeEntry).not.toBe("function");
    expect(typeof pinned.values).not.toBe("function");
    expect(typeof pinned.getDirectoryHandle).not.toBe("function");
  });
});

describe("demo mock deleteDirectory is in-memory only (fa6e72a76)", () => {
  it("does not throw and does not touch a real handle", async () => {
    // Seed an in-memory dir entry via a write, then delete it. The point is
    // that deleteDirectory resolves in-memory rather than falling through to
    // the (pinned, inert) handle and throwing while walking a real folder.
    await fileService.writeJson("users/alex/projects/p1.json", { id: "p1" });
    await expect(
      fileService.deleteDirectory("users/alex/projects"),
    ).resolves.not.toThrow();
    // The deleted entry is gone from the in-memory store.
    expect(await fileService.fileExists("users/alex/projects/p1.json")).toBe(
      false,
    );
  });

  it("deleteDirectory on an unknown path resolves false without throwing", async () => {
    await expect(
      fileService.deleteDirectory("users/nobody/nothing"),
    ).resolves.toBe(false);
  });
});
