// frontend/src/lib/storage/json-store.test.ts
//
// Regression-test wave 1 (PRIVACY + DATA INTEGRITY at the logic layer).
//
// JsonStore is the bedrock of the per-user persistence model and shipped
// with ZERO tests. Every cross-user read in the app funnels through
// `listAll` / `listAllForUser` / `get*`, so a single off-by-one in the
// path math would leak one user's records into another's view.
//
// These tests exercise the REAL JsonStore against a faithful in-memory
// file service. We mock only the file-system leaf (`fileService`): the
// in-memory backend maps absolute paths -> JSON blobs and reconstructs
// `listFiles(dir)` by enumerating keys under that directory, exactly the
// way the real FSA-backed service does. The store logic (path math, id
// namespacing, counters, store-type routing, sidecar skipping) is the
// REAL module under test.
//
// Coverage:
//   1. Per-user save -> read round-trips (save / get / listAll).
//   2. `listAllForUser(u)` returns ONLY user u's records — cross-user
//      isolation (the privacy bedrock). A save under user A is never
//      visible under user B.
//   3. id namespacing / counters: monotonic per namespace, independent
//      across users; a new user starts its own counter at 1.
//   4. Public vs user store types route to the right base path and
//      counter (public uses the global counter; two public-entity stores
//      share the global namespace).
//   5. Graceful handling of a missing / empty directory (listAll == []).
//   6. Sidecar skip: `projects/<id>-hosted.json` is not surfaced as a
//      Project record by listAll / listAllForUser.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Faithful in-memory file service ─────────────────────────────────────────
//
// Keys are absolute "paths" like "users/alex/notes/3.json". `listFiles`
// returns the bare file NAMES directly under the given dir (matching the
// real fileService.listFiles contract — names, not full paths). `ensureDir`
// is a no-op (the in-memory map has no directories of its own); a dir that
// was never written to simply has no matching keys, so listFiles returns [].

const memFs = new Map<string, unknown>();
let currentUserMock = "alex";

function listFilesImpl(dirPath: string): string[] {
  const prefix = `${dirPath}/`;
  const names: string[] = [];
  for (const key of memFs.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    // Only direct children (no nested slash) are "files in this dir".
    if (rest.includes("/")) continue;
    names.push(rest);
  }
  return names;
}

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dirPath: string) => listFilesImpl(dirPath)),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

// Imports must come after the mocks.
import {
  JsonStore,
  getUserStore,
  getPublicStore,
  clearCurrentUserCache,
} from "./json-store";

function setCurrentUser(name: string): void {
  currentUserMock = name;
  clearCurrentUserCache();
}

interface Note {
  id: number;
  title: string;
  owner: string;
}

beforeEach(() => {
  memFs.clear();
  setCurrentUser("alex");
});

describe("JsonStore — per-user round-trips", () => {
  it("save then get returns the same record under the current user", async () => {
    const store = getUserStore<Note>("notes");
    await store.save(3, { id: 3, title: "PCR recipe", owner: "alex" });

    expect(memFs.get("users/alex/notes/3.json")).toEqual({
      id: 3,
      title: "PCR recipe",
      owner: "alex",
    });

    const read = await store.get(3);
    expect(read).toEqual({ id: 3, title: "PCR recipe", owner: "alex" });
  });

  it("listAll returns every record for the current user, sorted by id", async () => {
    const store = getUserStore<Note>("notes");
    await store.save(5, { id: 5, title: "five", owner: "alex" });
    await store.save(1, { id: 1, title: "one", owner: "alex" });
    await store.save(3, { id: 3, title: "three", owner: "alex" });

    const all = await store.listAll();
    expect(all.map((n) => n.id)).toEqual([1, 3, 5]);
  });

  it("get returns null for an absent id", async () => {
    const store = getUserStore<Note>("notes");
    expect(await store.get(99)).toBeNull();
  });
});

describe("JsonStore — cross-user isolation (privacy bedrock)", () => {
  it("listAllForUser(u) returns ONLY user u's records", async () => {
    // Seed two users' notes directly on disk.
    memFs.set("users/alex/notes/1.json", { id: 1, title: "alex-1", owner: "alex" });
    memFs.set("users/alex/notes/2.json", { id: 2, title: "alex-2", owner: "alex" });
    memFs.set("users/morgan/notes/1.json", {
      id: 1,
      title: "morgan-1",
      owner: "morgan",
    });

    const store = getUserStore<Note>("notes");

    const alexNotes = await store.listAllForUser("alex");
    expect(alexNotes.map((n) => n.title).sort()).toEqual(["alex-1", "alex-2"]);

    const morganNotes = await store.listAllForUser("morgan");
    expect(morganNotes.map((n) => n.title)).toEqual(["morgan-1"]);
    // Morgan's view must NOT contain any of alex's records.
    expect(morganNotes.some((n) => n.owner === "alex")).toBe(false);
  });

  it("a save under user A is never visible under user B", async () => {
    const store = getUserStore<Note>("notes");

    setCurrentUser("alex");
    await store.save(7, { id: 7, title: "alex secret", owner: "alex" });

    // Switch the current user to morgan: the store now routes to
    // users/morgan/...
    setCurrentUser("morgan");
    const morganList = await store.listAll();
    expect(morganList).toEqual([]);
    expect(await store.get(7)).toBeNull();

    // And an explicit cross-user read for morgan stays empty.
    expect(await store.listAllForUser("morgan")).toEqual([]);
  });

  it("listAllForUser is unaffected by who the current user is", async () => {
    memFs.set("users/morgan/notes/4.json", {
      id: 4,
      title: "morgan-4",
      owner: "morgan",
    });
    const store = getUserStore<Note>("notes");

    setCurrentUser("alex");
    const fromAlex = await store.listAllForUser("morgan");
    setCurrentUser("morgan");
    const fromMorgan = await store.listAllForUser("morgan");

    expect(fromAlex).toEqual(fromMorgan);
    expect(fromAlex.map((n) => n.id)).toEqual([4]);
  });
});

describe("JsonStore — id namespacing / counters", () => {
  it("create assigns monotonically increasing ids within a user namespace", async () => {
    const store = getUserStore<Note>("notes");
    const a = await store.create({ title: "a", owner: "alex" } as Omit<Note, "id">);
    const b = await store.create({ title: "b", owner: "alex" } as Omit<Note, "id">);
    const c = await store.create({ title: "c", owner: "alex" } as Omit<Note, "id">);
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);

    // Counter persisted in the user's own _counters.json.
    expect(memFs.get("users/alex/_counters.json")).toEqual({ notes: 3 });
  });

  it("counters are independent across users (each starts at 1)", async () => {
    const store = getUserStore<Note>("notes");

    setCurrentUser("alex");
    const a1 = await store.create({ title: "a1", owner: "alex" } as Omit<Note, "id">);
    const a2 = await store.create({ title: "a2", owner: "alex" } as Omit<Note, "id">);

    setCurrentUser("morgan");
    const m1 = await store.create({ title: "m1", owner: "morgan" } as Omit<Note, "id">);

    expect([a1.id, a2.id]).toEqual([1, 2]);
    // Morgan's counter is independent — first create is id 1, not 3.
    expect(m1.id).toBe(1);
    expect(memFs.get("users/alex/_counters.json")).toEqual({ notes: 2 });
    expect(memFs.get("users/morgan/_counters.json")).toEqual({ notes: 1 });
  });

  it("counters are independent across entity namespaces for one user", async () => {
    const notes = getUserStore<Note>("notes");
    const tasks = getUserStore<{ id: number; owner: string }>("tasks");

    const n1 = await notes.create({ title: "n1", owner: "alex" } as Omit<Note, "id">);
    const t1 = await tasks.create({ owner: "alex" });
    const n2 = await notes.create({ title: "n2", owner: "alex" } as Omit<Note, "id">);

    expect(n1.id).toBe(1);
    expect(t1.id).toBe(1); // tasks namespace starts fresh
    expect(n2.id).toBe(2);
    expect(memFs.get("users/alex/_counters.json")).toEqual({ notes: 2, tasks: 1 });
  });

  it("createForUser bumps the TARGET user's counter, not the current user's", async () => {
    const store = getUserStore<Note>("notes");
    setCurrentUser("alex");
    // Give alex an existing counter so we can prove it isn't touched.
    memFs.set("users/alex/_counters.json", { notes: 9 });

    const made = await store.createForUser(
      { title: "for-morgan", owner: "morgan" } as Omit<Note, "id">,
      "morgan",
    );

    expect(made.id).toBe(1); // morgan's namespace, fresh counter
    expect(memFs.get("users/morgan/notes/1.json")).toMatchObject({
      title: "for-morgan",
    });
    // Alex's counter is untouched.
    expect(memFs.get("users/alex/_counters.json")).toEqual({ notes: 9 });
  });
});

describe("JsonStore — public vs user store types", () => {
  it("public store routes to users/public and uses the global counter", async () => {
    const pub = getPublicStore<{ id: number; name: string; owner: string }>(
      "methods",
    );
    const m1 = await pub.create({ name: "buffer prep", owner: "alex" });
    const m2 = await pub.create({ name: "gel run", owner: "morgan" });

    expect(m1.id).toBe(1);
    expect(m2.id).toBe(2);
    expect(memFs.get("users/public/methods/1.json")).toMatchObject({
      name: "buffer prep",
    });
    // Global counter, not a per-user one.
    expect(memFs.get("users/_global_counters.json")).toEqual({ methods: 2 });
  });

  it("user-scoped PUBLIC_ENTITIES (methods) also draw from the global counter", async () => {
    // `methods` is a PUBLIC_ENTITY: even when created through a user-scoped
    // store, ids come from the GLOBAL counter so a method id is unique across
    // the whole folder (methods are referenceable across users).
    const userMethods = getUserStore<{ id: number; name: string; owner: string }>(
      "methods",
    );
    setCurrentUser("alex");
    const a = await userMethods.create({ name: "alex method", owner: "alex" });
    setCurrentUser("morgan");
    const b = await userMethods.create({ name: "morgan method", owner: "morgan" });

    // Global namespace -> ids do NOT both start at 1.
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(memFs.get("users/_global_counters.json")).toEqual({ methods: 2 });
    // The records still land in their respective user folders.
    expect(memFs.get("users/alex/methods/1.json")).toMatchObject({
      name: "alex method",
    });
    expect(memFs.get("users/morgan/methods/2.json")).toMatchObject({
      name: "morgan method",
    });
  });

  it("createForUser rejects public-entity stores (they use global counters)", async () => {
    const userMethods = getUserStore<{ id: number; owner: string }>("methods");
    await expect(
      userMethods.createForUser({ owner: "morgan" }, "morgan"),
    ).rejects.toThrow(/global counters/i);
  });
});

describe("JsonStore — missing / empty directory", () => {
  it("listAll returns [] for a directory that was never written", async () => {
    const store = getUserStore<Note>("notes");
    setCurrentUser("nobody_home");
    expect(await store.listAll()).toEqual([]);
  });

  it("listAllForUser returns [] for an unknown user", async () => {
    const store = getUserStore<Note>("notes");
    expect(await store.listAllForUser("ghost")).toEqual([]);
  });

  it("non-.json files in the dir are ignored", async () => {
    memFs.set("users/alex/notes/1.json", { id: 1, title: "real", owner: "alex" });
    memFs.set("users/alex/notes/_counters.json.bak", { junk: true });
    memFs.set("users/alex/notes/README.md", "not a record");
    const store = getUserStore<Note>("notes");
    const all = await store.listAllForUser("alex");
    expect(all.map((n) => n.id)).toEqual([1]);
  });
});

describe("JsonStore — projects sidecar skip", () => {
  it("listAll does NOT surface <id>-hosted.json as a Project record", async () => {
    // The hosted-manifest sidecar lives in the projects dir but is shaped
    // { version, hostedTasks } — no id, no name. Without the skip it would
    // render as an orphan "(unnamed project)" card (tour orphan R1 bug).
    interface Project {
      id: number;
      name: string;
      owner: string;
    }
    memFs.set("users/alex/projects/1.json", {
      id: 1,
      name: "Real Project",
      owner: "alex",
    });
    memFs.set("users/alex/projects/1-hosted.json", {
      version: 1,
      hostedTasks: [],
    });

    const store = new JsonStore<Project>("projects", "user");
    const all = await store.listAllForUser("alex");
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Real Project");
    // No record with undefined id/name leaked through.
    expect(all.some((p) => p.id === undefined || p.name === undefined)).toBe(false);
  });
});
