// frontend/src/lib/users/propagate-rename.test.ts
//
// Tests for the user-rename propagation walker (orchestrator manager,
// 2026-05-27). Covers the unit-level rewriter, per-scope walks (own,
// others, public), and the end-to-end rename transaction that wires the
// helper into usersApi.rename.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── In-memory file-service mock ──────────────────────────────────────────────
//
// Matches the shape used by lib/user-rename.test.ts but trimmed to just
// what propagate-rename needs: listDirectories('users'), listFiles, readJson,
// writeJson. The rename-transaction end-to-end test below adds the
// directory-handle plumbing on top so the existing usersApi.rename copyTree
// path also runs.

type FakeFile = { kind: "file"; bytes: Uint8Array; name: string };
type FakeDir = {
  kind: "directory";
  name: string;
  entries: Map<string, FakeFile | FakeDir>;
};

function makeDir(name: string): FakeDir {
  return { kind: "directory", name, entries: new Map() };
}

function makeFile(name: string, contents = ""): FakeFile {
  return { kind: "file", name, bytes: new TextEncoder().encode(contents) };
}

function attachWritable(file: FakeFile): {
  createWritable: () => Promise<{
    write: (chunk: ArrayBuffer | Uint8Array | string | Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
} {
  return {
    createWritable: async () => {
      let buf = new Uint8Array(0);
      return {
        write: async (
          chunk: ArrayBuffer | Uint8Array | string | Blob,
        ): Promise<void> => {
          if (typeof chunk === "string") {
            buf = new TextEncoder().encode(chunk);
          } else if (chunk instanceof Uint8Array) {
            buf = new Uint8Array(chunk);
          } else if (chunk instanceof ArrayBuffer) {
            buf = new Uint8Array(chunk);
          } else {
            buf = new Uint8Array(await (chunk as Blob).arrayBuffer());
          }
        },
        close: async (): Promise<void> => {
          file.bytes = buf;
        },
      };
    },
  };
}

function wrapDir(dir: FakeDir): {
  kind: "directory";
  name: string;
  getDirectoryHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<ReturnType<typeof wrapDir>>;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<FakeFile & ReturnType<typeof attachWritable> & { getFile: () => Promise<Blob> }>;
  removeEntry: (
    name: string,
    opts?: { recursive?: boolean },
  ) => Promise<void>;
  values: () => AsyncIterable<unknown>;
} {
  return {
    kind: "directory" as const,
    name: dir.name,
    getDirectoryHandle: async (
      name: string,
      opts?: { create?: boolean },
    ): Promise<ReturnType<typeof wrapDir>> => {
      let entry = dir.entries.get(name);
      if (!entry && opts?.create) {
        const fresh = makeDir(name);
        dir.entries.set(name, fresh);
        entry = fresh;
      }
      if (!entry) {
        const err = new Error(`NotFoundError: ${name}`);
        err.name = "NotFoundError";
        throw err;
      }
      if (entry.kind !== "directory") {
        throw new Error(`Not a directory: ${name}`);
      }
      return wrapDir(entry);
    },
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      let entry = dir.entries.get(name);
      if (!entry && opts?.create) {
        const fresh = makeFile(name);
        dir.entries.set(name, fresh);
        entry = fresh;
      }
      if (!entry) {
        const err = new Error(`NotFoundError: ${name}`);
        err.name = "NotFoundError";
        throw err;
      }
      if (entry.kind !== "file") {
        throw new Error(`Not a file: ${name}`);
      }
      const file = entry;
      return {
        ...file,
        ...attachWritable(file),
        getFile: async (): Promise<Blob> => {
          const bytes = file.bytes;
          return {
            arrayBuffer: async () =>
              bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              ),
            text: async () => new TextDecoder().decode(bytes),
            size: bytes.byteLength,
            type: "",
            slice: () => new Blob(),
            stream: () => new ReadableStream(),
          } as unknown as Blob;
        },
      };
    },
    removeEntry: async (name: string): Promise<void> => {
      if (!dir.entries.has(name)) {
        const err = new Error(`NotFoundError: ${name}`);
        err.name = "NotFoundError";
        throw err;
      }
      dir.entries.delete(name);
    },
    values: async function* (): AsyncIterable<unknown> {
      for (const entry of dir.entries.values()) {
        if (entry.kind === "file") {
          yield {
            ...entry,
            ...attachWritable(entry),
            getFile: async (): Promise<Blob> => {
              const bytes = entry.bytes;
              return {
                arrayBuffer: async () =>
                  bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  ),
                text: async () => new TextDecoder().decode(bytes),
                size: bytes.byteLength,
                type: "",
                slice: () => new Blob(),
                stream: () => new ReadableStream(),
              } as unknown as Blob;
            },
          };
        } else {
          yield wrapDir(entry);
        }
      }
    },
  };
}

const root = makeDir("root");
const usersDir = makeDir("users");
root.entries.set("users", usersDir);

// memFs holds everything reachable via fileService.readJson / writeJson
// (path-keyed). Keeps the test fixtures readable: callers only need to
// set entries here, not maintain a parallel FSA tree.
const memFs = new Map<string, unknown>();

function setEntity(path: string, data: unknown): void {
  memFs.set(path, JSON.parse(JSON.stringify(data)));
}

function getEntity<T>(path: string): T | null {
  const v = memFs.get(path);
  if (v === undefined) return null;
  return JSON.parse(JSON.stringify(v)) as T;
}

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : JSON.parse(JSON.stringify(v));
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    isConnected: vi.fn(() => true),
    getDirectoryHandle: vi.fn(() => wrapDir(root)),
    getDirectory: vi.fn(async (path: string) => {
      if (path === "users") return wrapDir(usersDir);
      return null;
    }),
    listDirectories: vi.fn(async (dirPath: string) => {
      if (dirPath !== "users") return [];
      // Derive only from the FSA tree (usersDir.entries). Tests seed
      // entity sidecars in memFs and the user directories themselves in
      // usersDir.entries; the two namespaces are deliberately separate
      // so listDirectories doesn't trip the rename collision-check by
      // reporting a destination directory that's only logically present
      // in memFs.
      return Array.from(usersDir.entries.values())
        .filter((e) => e.kind === "directory")
        .map((e) => e.name)
        .sort();
    }),
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const out: string[] = [];
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue;
        out.push(rest);
      }
      return out.sort();
    }),
    deleteFile: vi.fn(async () => true),
    ensureDir: vi.fn(async () => null),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => ""),
  storeCurrentUser: vi.fn(async () => {}),
  clearCurrentUser: vi.fn(async () => {}),
  clearCurrentUserCache: vi.fn(() => {}),
  getMainUser: vi.fn(async () => ""),
  storeMainUser: vi.fn(async () => {}),
  clearMainUser: vi.fn(async () => {}),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import {
  propagateOwnerRename,
  rewriteUserFields,
} from "./propagate-rename";

beforeEach(() => {
  memFs.clear();
  usersDir.entries.clear();
});

// ── Pure rewriter ────────────────────────────────────────────────────────────

describe("rewriteUserFields", () => {
  it("rewrites owner / username / created_by / assignee / approved_by / declined_by when they match oldName", () => {
    const record = {
      owner: "alice",
      username: "alice",
      created_by: "alice",
      assignee: "alice",
      approved_by: "alice",
      declined_by: "alice",
      unrelated: "alice_smith", // substring, NOT exact match — must not change
    };
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(true);
    expect(record).toEqual({
      owner: "alice_v2",
      username: "alice_v2",
      created_by: "alice_v2",
      assignee: "alice_v2",
      approved_by: "alice_v2",
      declined_by: "alice_v2",
      unrelated: "alice_smith",
    });
  });

  it("rewrites flagged.by, external_project.owner, method_attachments[].owner", () => {
    const record = {
      flagged: { by: "alice", at: "2026-05-27T00:00:00Z", reason: null },
      external_project: { owner: "alice", id: 7, sharedAt: "now" },
      method_attachments: [
        { method_id: 1, owner: "alice" },
        { method_id: 2, owner: null },
        { method_id: 3, owner: "bob" },
      ],
    };
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(true);
    expect(record.flagged.by).toBe("alice_v2");
    expect(record.external_project.owner).toBe("alice_v2");
    expect(record.method_attachments[0].owner).toBe("alice_v2");
    expect(record.method_attachments[1].owner).toBe(null);
    expect(record.method_attachments[2].owner).toBe("bob");
  });

  it("rewrites shared_with[].username entries and preserves the whole-lab '*' sentinel", () => {
    const record = {
      shared_with: [
        { username: "alice", level: "edit" },
        { username: "bob", level: "read" },
        { username: "*", level: "read" },
      ],
    };
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(true);
    expect(record.shared_with).toEqual([
      { username: "alice_v2", level: "edit" },
      { username: "bob", level: "read" },
      { username: "*", level: "read" },
    ]);
  });

  it("rewrites comments[].author and comments[].mentions[] entries", () => {
    const record = {
      comments: [
        {
          id: "c1",
          author: "alice",
          text: "@alice ping",
          mentions: ["alice", "bob"],
        },
        {
          id: "c2",
          author: "bob",
          text: "reply",
          mentions: ["alice"],
        },
      ],
    };
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(true);
    expect(record.comments[0].author).toBe("alice_v2");
    expect(record.comments[0].mentions).toEqual(["alice_v2", "bob"]);
    expect(record.comments[1].author).toBe("bob");
    expect(record.comments[1].mentions).toEqual(["alice_v2"]);
  });

  it("returns false and mutates nothing when no field matches oldName", () => {
    const record = {
      owner: "bob",
      shared_with: [{ username: "carol", level: "read" }],
      created_by: null,
    };
    const snapshot = JSON.parse(JSON.stringify(record));
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(false);
    expect(record).toEqual(snapshot);
  });

  it("does not add fields that were missing — null/undefined stay as-is", () => {
    const record = {
      // No `owner`, no `shared_with`, no `created_by` — common for older
      // records that pre-date a given field. Helper must not invent them.
      flagged: null,
      external_project: null,
      method_attachments: null,
      shared_with: null,
      comments: null,
    };
    const snapshot = JSON.parse(JSON.stringify(record));
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(false);
    expect(record).toEqual(snapshot);
  });

  it("is idempotent: a second run with the same args is a no-op", () => {
    const record = {
      owner: "alice",
      shared_with: [{ username: "alice", level: "edit" }],
    };
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(true);
    expect(rewriteUserFields(record, "alice", "alice_v2")).toBe(false);
    expect(record.owner).toBe("alice_v2");
    expect(record.shared_with[0].username).toBe("alice_v2");
  });
});

// ── Per-scope walker ─────────────────────────────────────────────────────────

describe("propagateOwnerRename — own directory", () => {
  it("updates owner on every task in the renamed user's tasks/ folder", async () => {
    // Fixture: 3 tasks owned by the (already-renamed-on-disk) folder
    // 'newname'. Their owner string still says 'oldname' because the
    // folder copy didn't rewrite JSON contents.
    usersDir.entries.set("newname", makeDir("newname"));
    setEntity("users/newname/tasks/1.json", {
      id: 1,
      name: "Task 1",
      owner: "oldname",
      shared_with: [],
    });
    setEntity("users/newname/tasks/2.json", {
      id: 2,
      name: "Task 2",
      owner: "oldname",
      shared_with: [{ username: "morgan", level: "read" }],
    });
    setEntity("users/newname/tasks/3.json", {
      id: 3,
      name: "Task 3",
      owner: "oldname",
      shared_with: [],
    });

    const result = await propagateOwnerRename("oldname", "newname");

    expect(result.own.updated).toBe(3);
    expect(result.own.byEntity.tasks).toBe(3);
    expect(getEntity<{ owner: string }>("users/newname/tasks/1.json")?.owner).toBe(
      "newname",
    );
    expect(getEntity<{ owner: string }>("users/newname/tasks/2.json")?.owner).toBe(
      "newname",
    );
    expect(getEntity<{ owner: string }>("users/newname/tasks/3.json")?.owner).toBe(
      "newname",
    );
  });

  it("rewrites shared_with entries in OTHER users' records that reference the renamed user", async () => {
    // alex's task is shared with the renamed user (was 'oldname', now 'newname').
    setEntity("users/alex/tasks/9.json", {
      id: 9,
      name: "Alex's task",
      owner: "alex",
      shared_with: [
        { username: "oldname", level: "edit" },
        { username: "morgan", level: "read" },
      ],
    });
    // Ensure alex's directory shows up in listDirectories.
    usersDir.entries.set("alex", makeDir("alex"));
    usersDir.entries.set("newname", makeDir("newname"));

    const result = await propagateOwnerRename("oldname", "newname");

    expect(result.others.updated).toBe(1);
    expect(result.others.byEntity.tasks).toBe(1);
    const updated = getEntity<{
      shared_with: { username: string; level: string }[];
    }>("users/alex/tasks/9.json");
    expect(updated?.shared_with).toEqual([
      { username: "newname", level: "edit" },
      { username: "morgan", level: "read" },
    ]);
  });

  it("rewrites created_by on public-namespace methods authored by the renamed user", async () => {
    setEntity("users/public/methods/1.json", {
      id: 1,
      name: "Public method",
      created_by: "oldname",
      is_public: true,
      owner: "public",
      shared_with: [{ username: "*", level: "read" }],
    });
    setEntity("users/public/methods/2.json", {
      id: 2,
      name: "Other public method",
      created_by: "alex",
      is_public: true,
      owner: "public",
      shared_with: [{ username: "*", level: "read" }],
    });

    const result = await propagateOwnerRename("oldname", "newname");

    expect(result.publicNs.updated).toBe(1);
    expect(result.publicNs.byEntity.methods).toBe(1);
    expect(
      getEntity<{ created_by: string }>("users/public/methods/1.json")?.created_by,
    ).toBe("newname");
    expect(
      getEntity<{ created_by: string }>("users/public/methods/2.json")?.created_by,
    ).toBe("alex");
    // Whole-lab sentinel preserved.
    expect(
      getEntity<{ shared_with: { username: string }[] }>(
        "users/public/methods/1.json",
      )?.shared_with[0].username,
    ).toBe("*");
  });

  it("walks the full mixed fixture: tasks owned + shared_with in another user + public created_by", async () => {
    // 3 tasks owned by oldname
    setEntity("users/newname/tasks/1.json", {
      id: 1,
      owner: "oldname",
      shared_with: [],
    });
    setEntity("users/newname/tasks/2.json", {
      id: 2,
      owner: "oldname",
      shared_with: [],
    });
    setEntity("users/newname/tasks/3.json", {
      id: 3,
      owner: "oldname",
      shared_with: [],
    });
    // 1 task by alex with shared_with: [oldname]
    setEntity("users/alex/tasks/9.json", {
      id: 9,
      owner: "alex",
      shared_with: [{ username: "oldname", level: "edit" }],
    });
    // 1 public method with created_by: oldname
    setEntity("users/public/methods/1.json", {
      id: 1,
      created_by: "oldname",
      owner: "public",
      shared_with: [{ username: "*", level: "read" }],
    });
    usersDir.entries.set("alex", makeDir("alex"));
    usersDir.entries.set("newname", makeDir("newname"));

    const result = await propagateOwnerRename("oldname", "newname");

    expect(result.own.updated).toBe(3);
    expect(result.others.updated).toBe(1);
    expect(result.publicNs.updated).toBe(1);

    // Spot-check each file
    expect(getEntity<{ owner: string }>("users/newname/tasks/1.json")?.owner).toBe(
      "newname",
    );
    expect(
      getEntity<{ shared_with: { username: string }[] }>(
        "users/alex/tasks/9.json",
      )?.shared_with[0].username,
    ).toBe("newname");
    expect(
      getEntity<{ created_by: string }>("users/public/methods/1.json")?.created_by,
    ).toBe("newname");
  });
});

describe("propagateOwnerRename — edge cases", () => {
  it("returns an empty result when oldName === newName (no-op)", async () => {
    usersDir.entries.set("alice", makeDir("alice"));
    setEntity("users/alice/tasks/1.json", {
      id: 1,
      owner: "alice",
      shared_with: [],
    });

    const result = await propagateOwnerRename("alice", "alice");
    expect(result.own.updated).toBe(0);
    expect(result.others.updated).toBe(0);
    expect(result.publicNs.updated).toBe(0);
  });

  it("returns an empty result when no entity files exist (fresh folder)", async () => {
    usersDir.entries.set("newname", makeDir("newname"));
    const result = await propagateOwnerRename("oldname", "newname");
    expect(result.own.updated).toBe(0);
    expect(result.others.updated).toBe(0);
    expect(result.publicNs.updated).toBe(0);
  });

  it("skips entities that have no owner field at all (does not add the field)", async () => {
    usersDir.entries.set("newname", makeDir("newname"));
    setEntity("users/newname/dependencies/1.json", {
      id: 1,
      parent_id: 1,
      child_id: 2,
      dep_type: "FS",
    });
    setEntity("users/newname/events/1.json", {
      id: 1,
      title: "Event",
      event_type: "meeting",
      start_date: "2026-05-27",
      end_date: null,
      start_time: null,
      end_time: null,
      location: null,
      url: null,
      notes: null,
      color: null,
    });

    const result = await propagateOwnerRename("oldname", "newname");
    expect(result.own.updated).toBe(0);
    // Field should NOT have been added.
    const dep = getEntity<Record<string, unknown>>(
      "users/newname/dependencies/1.json",
    );
    expect(dep && "owner" in dep).toBe(false);
    const ev = getEntity<Record<string, unknown>>(
      "users/newname/events/1.json",
    );
    expect(ev && "owner" in ev).toBe(false);
  });

  it("handles shared_with: [] (no-op for that field)", async () => {
    usersDir.entries.set("newname", makeDir("newname"));
    setEntity("users/newname/projects/1.json", {
      id: 1,
      name: "Project",
      owner: "newname", // already correct
      shared_with: [],
    });
    const result = await propagateOwnerRename("oldname", "newname");
    expect(result.own.updated).toBe(0);
  });

  it("skips public records with created_by: null", async () => {
    setEntity("users/public/methods/1.json", {
      id: 1,
      name: "Old public method (anonymous)",
      created_by: null,
      is_public: true,
      owner: "public",
      shared_with: [{ username: "*", level: "read" }],
    });
    const result = await propagateOwnerRename("oldname", "newname");
    expect(result.publicNs.updated).toBe(0);
    expect(
      getEntity<{ created_by: unknown }>("users/public/methods/1.json")
        ?.created_by,
    ).toBe(null);
  });

  it("rewrites project hosted-manifest sidecar entries (owner + sharedBy)", async () => {
    // morgan hosts alex's task in their project. After renaming alex to
    // alex_v2, the manifest entry's owner field needs to flip too.
    setEntity("users/morgan/projects/5.json", {
      id: 5,
      name: "Morgan project",
      owner: "morgan",
      shared_with: [],
    });
    setEntity("users/morgan/projects/5-hosted.json", {
      version: 1,
      hostedTasks: [
        {
          owner: "oldname",
          taskId: 9,
          sharedAt: "2026-05-20T00:00:00Z",
          sharedBy: "oldname",
        },
        {
          owner: "bob",
          taskId: 11,
          sharedAt: "2026-05-21T00:00:00Z",
          sharedBy: "bob",
        },
      ],
    });
    usersDir.entries.set("morgan", makeDir("morgan"));
    usersDir.entries.set("newname", makeDir("newname"));

    const result = await propagateOwnerRename("oldname", "newname");
    expect(result.others.byEntity["projects-hosted"]).toBe(1);

    const manifest = getEntity<{
      hostedTasks: { owner: string; sharedBy: string }[];
    }>("users/morgan/projects/5-hosted.json");
    expect(manifest?.hostedTasks[0]).toMatchObject({
      owner: "newname",
      sharedBy: "newname",
    });
    expect(manifest?.hostedTasks[1]).toMatchObject({
      owner: "bob",
      sharedBy: "bob",
    });
  });

  it("logs and continues when a single readJson throws (per-file failures do not abort the walk)", async () => {
    // Seed two task files; arrange for one to throw on read by stubbing
    // the underlying readJson once. The other file must still be rewritten.
    usersDir.entries.set("newname", makeDir("newname"));
    setEntity("users/newname/tasks/1.json", {
      id: 1,
      owner: "oldname",
      shared_with: [],
    });
    setEntity("users/newname/tasks/2.json", {
      id: 2,
      owner: "oldname",
      shared_with: [],
    });

    const { fileService } = await import("../file-system/file-service");
    const originalRead = fileService.readJson;
    const readSpy = vi.spyOn(fileService, "readJson");
    readSpy.mockImplementationOnce(async (path: string) => {
      if (path === "users/newname/tasks/1.json") {
        throw new Error("simulated read corruption");
      }
      return originalRead(path);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await propagateOwnerRename("oldname", "newname");
    expect(result.own.updated).toBe(1); // task 2 still rewritten
    expect(
      getEntity<{ owner: string }>("users/newname/tasks/2.json")?.owner,
    ).toBe("newname");

    readSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ── Integration: full usersApi.rename transaction ────────────────────────────

import { usersApi } from "../local-api";

describe("usersApi.rename — owner-field propagation integration", () => {
  it("renames a user and rewrites task owner + shared_with + public created_by in one transaction", async () => {
    // The propagation walker reads/writes JSON through fileService.readJson /
    // writeJson (memFs in this suite). The rename transaction itself does
    // a separate FSA-level copyTree (against the parallel usersDir FSA
    // tree). To keep the test focused on the propagation contract while
    // still exercising the integration wiring, we seed the post-copy state
    // in memFs (paths under users/newname/) plus pre-set the FSA tree so
    // the FSA copyTree path succeeds. The propagation step rewriting
    // user-bearing fields under the new directory is what this test pins.
    usersDir.entries.set("oldname", makeDir("oldname"));
    memFs.set("users/_user_metadata.json", {
      users: {
        oldname: {
          color: "#3b82f6",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    // Post-copy state: the task / project sidecars live under the NEW
    // directory but still carry stale owner === 'oldname' stamps. That is
    // precisely the bug the propagation step exists to fix.
    setEntity("users/newname/tasks/1.json", {
      id: 1,
      project_id: 1,
      name: "task 76 (orchestration arc)",
      owner: "oldname",
      shared_with: [],
    });
    setEntity("users/newname/projects/1.json", {
      id: 1,
      name: "Orchestration",
      owner: "oldname",
      shared_with: [],
    });
    // Foreign user alex shared a task with oldname.
    usersDir.entries.set("alex", makeDir("alex"));
    setEntity("users/alex/tasks/9.json", {
      id: 9,
      name: "Alex's shared task",
      owner: "alex",
      shared_with: [{ username: "oldname", level: "edit" }],
    });
    // Public method authored by oldname.
    setEntity("users/public/methods/1.json", {
      id: 1,
      name: "Western blot protocol",
      created_by: "oldname",
      is_public: true,
      owner: "public",
      shared_with: [{ username: "*", level: "read" }],
    });

    const out = await usersApi.rename("oldname", "newname");
    expect(out.status).toBe("ok");
    expect(out.new_username).toBe("newname");

    // CRITICAL: task.owner now points at 'newname', so taskResultsBase
    // resolves to users/newname/results/task-1/* — the on-disk location.
    expect(
      getEntity<{ owner: string }>("users/newname/tasks/1.json")?.owner,
    ).toBe("newname");
    expect(
      getEntity<{ owner: string }>("users/newname/projects/1.json")?.owner,
    ).toBe("newname");

    // Foreign user's shared_with entry migrated.
    expect(
      getEntity<{ shared_with: { username: string }[] }>(
        "users/alex/tasks/9.json",
      )?.shared_with[0].username,
    ).toBe("newname");

    // Public method created_by migrated.
    expect(
      getEntity<{ created_by: string }>("users/public/methods/1.json")
        ?.created_by,
    ).toBe("newname");
  });
});
