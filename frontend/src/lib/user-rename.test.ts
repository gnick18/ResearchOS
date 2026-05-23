// frontend/src/lib/user-rename.test.ts
//
// Regression tests for usersApi.rename — the fix for the 2026-05-23 bug
// where renaming a user (e.g. alex → alex_renamed) and then trying to
// change their color from Settings threw
// `NoModificationAllowedError: Failed to execute 'createWritable' on
// 'FileSystemFileHandle'`.
//
// Three compounding root causes covered here:
//   1. The user's `_user_metadata.json` entry was NOT migrated on rename —
//      the entry stayed keyed under the OLD username, so the user's color
//      / hide-flag / created_at silently "vanished" after rename.
//   2. The collision check was naive: case-sensitive directory-handle
//      lookup only. `alice` vs `Alice` collided silently on
//      case-insensitive filesystems (macOS APFS default, Windows NTFS).
//      Tombstoned users (deleted_at set in metadata) were also ignored —
//      renaming over a tombstone would silently un-tombstone the entry.
//   3. (See user-metadata.test.ts for the matching test) the
//      `setUserMetadataColors` call from Settings was NOT in the metadata
//      write queue, so it could race a concurrent ensureLabUserMetadata
//      and surface as the createWritable lock error. Fixed by routing
//      setUserMetadataColors through the same enqueueMetadataWrite that
//      setUserMetadataField uses.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Minimal in-memory FSA shape for the rename copyTree + removeEntry ──────
//
// The rename function calls:
//   - fileService.getDirectoryHandle()  (truthy guard only)
//   - fileService.getDirectory("users") → a directory handle with
//     getDirectoryHandle / removeEntry / values
//   - fileService.listDirectories("users") → sibling-name collision check
//   - readAllUserMetadata() (read-only) → metadata-collision check
//   - renameUserMetadataEntry(old, new) → migrates the entry
//
// We mock the file-service surface directly so we don't have to drag in
// the full FSA prototype. The fake directory handles are tiny objects
// that mutate an in-memory tree.

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

// Attach a fake FSA writable to a fake file. write() captures bytes;
// close() commits them. createWritable returns a fresh writable each time
// (the production fileService.atomicWrite uses tmpFile.createWritable in
// the copyTree loop).
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
    getFileHandle: async (
      name: string,
      opts?: { create?: boolean },
    ) => {
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
          // Re-wrap files so the rename copyTree gets a getFile() / handle-
          // shaped object (matches the wrapped getFileHandle return).
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

// JSON sidecar files (read/written by readAllUserMetadata + renameUserMetadataEntry).
// Stored separately from the FakeDir tree because the production code goes
// through fileService.readJson / writeJson, not the FSA dirHandle path.
const memFs = new Map<string, unknown>();

vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
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
    listDirectories: vi.fn(async (path: string) => {
      if (path !== "users") return [];
      return Array.from(usersDir.entries.values())
        .filter((e) => e.kind === "directory")
        .map((e) => e.name)
        .sort();
    }),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    ensureDir: vi.fn(async () => null),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => ""),
  storeCurrentUser: vi.fn(async () => {}),
  clearCurrentUser: vi.fn(async () => {}),
  clearCurrentUserCache: vi.fn(() => {}),
  getMainUser: vi.fn(async () => ""),
  storeMainUser: vi.fn(async () => {}),
  clearMainUser: vi.fn(async () => {}),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { usersApi } from "./local-api";
import { readAllUserMetadata } from "./file-system/user-metadata";

beforeEach(() => {
  memFs.clear();
  usersDir.entries.clear();
});

describe("usersApi.rename — metadata entry migration", () => {
  it("migrates the user's color / created_at / hide_goals_from_lab from the old key to the new key", async () => {
    // Seed: a `chickenfingers` user with a custom color + gradient + flag.
    usersDir.entries.set("chickenfingers", makeDir("chickenfingers"));
    memFs.set("users/_user_metadata.json", {
      users: {
        chickenfingers: {
          color: "#ef4444",
          color_secondary: "#10b981",
          created_at: "2026-01-01T00:00:00.000Z",
          hide_goals_from_lab: true,
        },
      },
    });

    const result = await usersApi.rename("chickenfingers", "renamed_account");
    expect(result.status).toBe("ok");
    expect(result.new_username).toBe("renamed_account");

    // Folder moved on disk.
    expect(usersDir.entries.has("chickenfingers")).toBe(false);
    expect(usersDir.entries.has("renamed_account")).toBe(true);

    // Metadata entry migrated — color and gradient and flag preserved
    // under the NEW username key. The OLD key is gone.
    const meta = await readAllUserMetadata();
    expect(meta.chickenfingers).toBeUndefined();
    expect(meta.renamed_account?.color).toBe("#ef4444");
    expect(meta.renamed_account?.color_secondary).toBe("#10b981");
    expect(meta.renamed_account?.hide_goals_from_lab).toBe(true);
    expect(meta.renamed_account?.created_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not blow up when the user has no metadata entry yet (fresh user)", async () => {
    // Some users (created before the metadata file existed, or imports
    // that skipped the ensure step) won't have an entry. The rename
    // should still succeed — there's just nothing to migrate.
    usersDir.entries.set("oldname", makeDir("oldname"));
    memFs.set("users/_user_metadata.json", { users: {} });

    const result = await usersApi.rename("oldname", "newname");
    expect(result.status).toBe("ok");

    const meta = await readAllUserMetadata();
    expect(meta.oldname).toBeUndefined();
    expect(meta.newname).toBeUndefined(); // not auto-created during rename
  });
});

describe("usersApi.rename — collision check", () => {
  it("rejects a rename to a name that already exists (case-sensitive match)", async () => {
    usersDir.entries.set("alice", makeDir("alice"));
    usersDir.entries.set("bob", makeDir("bob"));

    await expect(usersApi.rename("alice", "bob")).rejects.toThrow(
      /already in use/i,
    );

    // Both folders intact after the failed rename.
    expect(usersDir.entries.has("alice")).toBe(true);
    expect(usersDir.entries.has("bob")).toBe(true);
  });

  it("rejects a rename to a name that differs only in case (case-insensitive guard)", async () => {
    // macOS APFS default + NTFS treat `Alice` and `alice` as the same
    // on-disk folder. Without the lowercase guard, the rename would
    // silently corrupt both users by overwriting one with the other.
    usersDir.entries.set("alice", makeDir("alice"));
    usersDir.entries.set("Bob", makeDir("Bob"));

    await expect(usersApi.rename("alice", "Bob")).rejects.toThrow(
      /already in use/i,
    );
    await expect(usersApi.rename("Bob", "ALICE")).rejects.toThrow(
      /already in use/i,
    );

    // Both folders intact after the failed rename.
    expect(usersDir.entries.has("alice")).toBe(true);
    expect(usersDir.entries.has("Bob")).toBe(true);
  });

  it("rejects a rename onto a tombstoned name (metadata entry with deleted_at)", async () => {
    // Tombstones are the durable delete record (INVESTIGATION_USER_LEAKS.md).
    // Renaming onto a tombstoned name would silently un-tombstone the
    // ghost entry — merging two users' history into one. Refuse.
    usersDir.entries.set("alex", makeDir("alex"));
    memFs.set("users/_user_metadata.json", {
      users: {
        alex: {
          color: "#3b82f6",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        old_deleted_user: {
          color: "#ef4444",
          created_at: "2025-01-01T00:00:00.000Z",
          deleted_at: "2026-05-01T00:00:00.000Z",
        },
      },
    });

    await expect(
      usersApi.rename("alex", "old_deleted_user"),
    ).rejects.toThrow(/tombstoned|previously deleted/i);

    // alex folder + meta untouched.
    expect(usersDir.entries.has("alex")).toBe(true);
    const meta = await readAllUserMetadata();
    expect(meta.alex).toBeDefined();
  });

  it("allows a no-op rename (oldUsername === sanitized newUsername)", async () => {
    usersDir.entries.set("alice", makeDir("alice"));

    const result = await usersApi.rename("alice", "alice");
    expect(result.status).toBe("ok");
    expect(result.new_username).toBe("alice");

    // No-op: folder still there.
    expect(usersDir.entries.has("alice")).toBe(true);
  });

  it("rejects a rename when the new username is empty or invalid-only characters", async () => {
    usersDir.entries.set("alice", makeDir("alice"));

    await expect(usersApi.rename("alice", "")).rejects.toThrow();
    await expect(usersApi.rename("alice", "!!!")).rejects.toThrow();
    await expect(usersApi.rename("alice", "   ")).rejects.toThrow();

    // Folder still there.
    expect(usersDir.entries.has("alice")).toBe(true);
  });
});
