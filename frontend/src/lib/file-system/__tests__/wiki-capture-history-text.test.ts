// @vitest-environment jsdom
//
// Fixture-mock raw-TEXT store: version-history engine in fixture mode.
//
// The bug (diagnosed by VC persona testing): in `?wikiCapture=1` / `/demo`
// fixture mode, editing + saving a note persisted the note but version
// history NEVER recorded. The fixture fileService mock
// (wiki-capture-mock.ts) overrode readJson / writeJson + the blob methods
// but NOT readText / writeText / atomicWrite, and set no real directory
// handle. The history storage layer (lib/history/storage.ts) uses
// readText / writeText EXCLUSIVELY for the
// `users/<owner>/_history/<type>/<id>.jsonl` files, so it hit the real
// File System Access path with no handle and threw "No directory handle
// set" (swallowed best-effort, so the note still saved but zero history
// rows were written).
//
// The fix adds an in-memory TEXT-file backing store to the mock and wires
// readText / writeText / atomicWrite (plus fileExists / deleteFile / list*
// siblings) against it. These tests pin:
//   1. writeText -> readText round-trips on an `_history` path, and a
//      missing-path readText returns null (mirroring the real fileService).
//   2. An appendEdit through the real history engine, bound to the mocked
//      fileService, records rows WITHOUT throwing "No directory handle set"
//      and the `_history/notes/<id>.jsonl` accumulates across edits.
//
// jsdom is required because `installWikiCaptureFixture` reads
// `window.location.search` (for the `?wizardSeedStep=` sidecar branch) and
// touches sessionStorage. The IndexedDB + idb-keyval + fetch shims below
// mirror the existing demo-handle-preservation / wiki-capture tests; the
// install's demo-asset fetches are best-effort, so a non-ok fetch stub
// just leaves those blobs unseeded (irrelevant to the history path).

import { describe, expect, it, beforeAll, vi } from "vitest";

// ── In-memory idb-keyval mock (indexeddb-store user-scalar keys) ────────────
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

// ── In-memory `indexedDB` global shim (directory-handle store) ──────────────
// Same minimal shape the demo-handle-preservation test uses: a Map per
// store, async request/transaction replay. The install seeds a fake handle
// here; we never read it back, so a passthrough shim is enough.
function makeIndexedDBShim() {
  const stores = new Map<string, Map<string, unknown>>();
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
  function makeStore(name: string) {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name)!;
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
      transaction: () => makeTransaction(),
      close: () => {},
    };
  }
  const indexedDB = {
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
  return indexedDB;
}

// ── Imports (after vi.mock) ─────────────────────────────────────────────────
import { fileService } from "../file-service";
import { installWikiCaptureFixture } from "../wiki-capture-mock";
import { HistoryEngine } from "../../history/engine";
import { fileServiceHistoryStorage, historyFilePath } from "../../history/storage";

// `installWikiCaptureFixture` is idempotent (a module-level `installed`
// guard returns early on a second call), so the whole suite installs once.
beforeAll(async () => {
  vi.stubGlobal("indexedDB", makeIndexedDBShim());
  // The install fetches demo PNGs / markdown best-effort. A non-ok stub
  // makes every such fetch a no-op (the loops just console.warn + skip),
  // which is exactly what we want: none of it touches the history path.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
  );
  await installWikiCaptureFixture({ signIn: true, fixtureUser: "alex" });
});

const svc = fileService;

describe("fixture mock: raw-TEXT store (readText / writeText)", () => {
  it("round-trips writeText -> readText on an _history path", async () => {
    const path = historyFilePath("alex", "notes", "round-trip-1");
    const body = '{"kind":"genesis"}\n{"kind":"update"}\n';
    await svc.writeText(path, body);
    expect(await svc.readText(path)).toBe(body);
  });

  it("returns null from readText for a missing path (mirrors real fileService)", async () => {
    const path = historyFilePath("alex", "notes", "never-written");
    expect(await svc.readText(path)).toBeNull();
  });

  it("reports a written _history file via fileExists", async () => {
    const path = historyFilePath("alex", "notes", "exists-probe");
    expect(await svc.fileExists(path)).toBe(false);
    await svc.writeText(path, "x\n");
    expect(await svc.fileExists(path)).toBe(true);
  });

  it("deletes a written _history file via deleteFile", async () => {
    const path = historyFilePath("alex", "notes", "delete-probe");
    await svc.writeText(path, "x\n");
    expect(await svc.deleteFile(path)).toBe(true);
    expect(await svc.readText(path)).toBeNull();
    // Deleting a missing path returns false (mirrors real fileService).
    expect(await svc.deleteFile(path)).toBe(false);
  });

  it("routes atomicWrite of a string through the text store", async () => {
    const path = historyFilePath("alex", "notes", "atomic-probe");
    const svcAny = svc as unknown as {
      atomicWrite: (p: string, payload: string | Blob) => Promise<void>;
    };
    await svcAny.atomicWrite(path, "atomic-body\n");
    expect(await svc.readText(path)).toBe("atomic-body\n");
  });
});

describe("history engine appendEdit against the fixture mock", () => {
  // The production storage binding reads/writes through the same singleton
  // `fileService` the install patched, so the engine here uses the default
  // fileServiceHistoryStorage — exactly the production wiring, just against
  // the mocked fileService.
  const engine = new HistoryEngine({ storage: fileServiceHistoryStorage });

  it("records a genesis + delta row on first edit (no 'No directory handle set')", async () => {
    const owner = "alex";
    const id = "note-appendedit-1";
    const path = historyFilePath(owner, "notes", id);

    // No history file yet.
    expect(await engine.readHistory("notes", owner, id)).toEqual([]);

    await expect(
      engine.appendEdit({
        type: "update",
        entityType: "notes",
        id,
        owner,
        actor: "alex",
        prevState: null,
        nextState: { body: "PCR master mix v1" },
      }),
    ).resolves.toBeUndefined();

    // A fresh record writes a genesis row + the first delta row = 2 rows.
    const rows = await engine.readHistory("notes", owner, id);
    expect(rows.length).toBe(2);
    expect(rows[0].kind).toBe("genesis");
    expect(rows[1].kind).toBe("update");

    // The jsonl body actually landed in the text store at the engine path.
    const raw = await svc.readText(path);
    expect(raw).not.toBeNull();
    expect((raw as string).trim().split("\n").length).toBe(2);
  });

  it("accumulates rows across successive edits (in-session history grows)", async () => {
    const owner = "alex";
    const id = "note-appendedit-2";

    await engine.appendEdit({
      type: "update",
      entityType: "notes",
      id,
      owner,
      actor: "alex",
      prevState: null,
      nextState: { body: "step 1" },
    });
    await engine.appendEdit({
      type: "update",
      entityType: "notes",
      id,
      owner,
      actor: "alex",
      prevState: { body: "step 1" },
      nextState: { body: "step 2" },
    });
    await engine.appendEdit({
      type: "update",
      entityType: "notes",
      id,
      owner,
      actor: "alex",
      prevState: { body: "step 2" },
      nextState: { body: "step 3" },
    });

    // genesis + 3 deltas = 4 rows.
    const rows = await engine.readHistory("notes", owner, id);
    expect(rows.length).toBe(4);
    expect(rows[0].kind).toBe("genesis");
    expect(rows.slice(1).every((r) => r.kind === "update")).toBe(true);
  });

  it("reconstructs the latest state from the accumulated rows", async () => {
    const owner = "alex";
    const id = "note-appendedit-3";

    await engine.appendEdit({
      type: "update",
      entityType: "notes",
      id,
      owner,
      actor: "alex",
      prevState: null,
      nextState: { body: "first" },
    });
    await engine.appendEdit({
      type: "update",
      entityType: "notes",
      id,
      owner,
      actor: "alex",
      prevState: { body: "first" },
      nextState: { body: "second" },
    });

    const rows = await engine.readHistory("notes", owner, id);
    // HEAD is the last row (index = rows.length - 1).
    const headCanonical = await engine.reconstructState(
      "notes",
      owner,
      id,
      rows.length - 1,
    );
    expect(JSON.parse(headCanonical)).toEqual({ body: "second" });
  });
});
