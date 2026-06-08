// Lab-tier Phase 7a: unit tests for the production FSA-backed MigrationFs adapter.
//
// Mocks @/lib/file-system/file-service with an in-memory fake that uses
// a Map<path, string> for files and a Set<string> for directories, then
// exercises each MigrationFs method including a directory-subtree rename.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory fake fileService
// ---------------------------------------------------------------------------

// Shared state mutated by the fake; reset in beforeEach.
let fakeFiles: Map<string, string>;
let fakeDirs: Set<string>;

function resetFakeFs(): void {
  fakeFiles = new Map();
  fakeDirs = new Set();
}

/** Seed a file (also implicitly seeds all ancestor directories). */
function seedFile(path: string, content: string): void {
  fakeFiles.set(path, content);
  // Ensure each ancestor directory is known.
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    fakeDirs.add(parts.slice(0, i).join("/"));
  }
}

/** Seed a directory and all its ancestors. */
function seedDir(path: string): void {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    fakeDirs.add(parts.slice(0, i).join("/"));
  }
}

// ---------------------------------------------------------------------------
// The mock — placed BEFORE the module under test is imported so vi.mock
// hoisting kicks in correctly.
// ---------------------------------------------------------------------------

vi.mock("@/lib/file-system/file-service", () => {
  const fake = {
    readText: vi.fn(async (path: string) => fakeFiles.get(path) ?? null),

    writeText: vi.fn(async (path: string, content: string) => {
      fakeFiles.set(path, content);
      // Seed ancestor dirs.
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        fakeDirs.add(parts.slice(0, i).join("/"));
      }
    }),

    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      const names: string[] = [];
      for (const p of fakeFiles.keys()) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length);
          if (!rest.includes("/")) {
            names.push(rest);
          }
        }
      }
      return names.sort();
    }),

    listDirectories: vi.fn(async (dirPath: string) => {
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      const names = new Set<string>();
      // A directory is a child if fakeDirs contains `${prefix}${name}` and
      // name has no further slashes.
      for (const d of fakeDirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          if (rest.length > 0 && !rest.includes("/")) {
            names.add(rest);
          }
        }
      }
      // Also pick up implicit directories inferred from file paths.
      for (const p of fakeFiles.keys()) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length);
          const slash = rest.indexOf("/");
          if (slash > 0) {
            names.add(rest.slice(0, slash));
          }
        }
      }
      return [...names].sort();
    }),

    ensureDir: vi.fn(async (dirPath: string) => {
      seedDir(dirPath);
      return null; // FileSystemDirectoryHandle not needed in tests
    }),

    fileExists: vi.fn(async (path: string) => {
      return fakeFiles.has(path) || fakeDirs.has(path);
    }),

    deleteFile: vi.fn(async (path: string) => {
      return fakeFiles.delete(path);
    }),

    deleteDirectory: vi.fn(async (path: string) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      // Remove all files under this directory.
      for (const p of [...fakeFiles.keys()]) {
        if (p === path || p.startsWith(prefix)) {
          fakeFiles.delete(p);
        }
      }
      // Remove all directory entries under (and including) this directory.
      for (const d of [...fakeDirs]) {
        if (d === path || d.startsWith(prefix)) {
          fakeDirs.delete(d);
        }
      }
      return true;
    }),
  };

  return { fileService: fake };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mock is registered.
// ---------------------------------------------------------------------------

import { createFsaMigrationFs } from "../migration-fs-fsa";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createFsaMigrationFs", () => {
  beforeEach(() => {
    resetFakeFs();
  });

  // -- listDir ---------------------------------------------------------------

  describe("listDir", () => {
    it("merges directories and files with correct kinds", async () => {
      seedFile("data/notes.json", "{}");
      seedFile("data/tasks.json", "{}");
      seedDir("data/images");
      seedDir("data/archive");

      const mfs = createFsaMigrationFs();
      const entries = await mfs.listDir("data");

      const dirs = entries.filter((e) => e.kind === "dir").map((e) => e.name);
      const files = entries.filter((e) => e.kind === "file").map((e) => e.name);

      expect(dirs).toContain("images");
      expect(dirs).toContain("archive");
      expect(files).toContain("notes.json");
      expect(files).toContain("tasks.json");
    });

    it("returns an empty array for a non-existent directory", async () => {
      const mfs = createFsaMigrationFs();
      const entries = await mfs.listDir("does/not/exist");
      expect(entries).toEqual([]);
    });
  });

  // -- readFile --------------------------------------------------------------

  describe("readFile", () => {
    it("returns the file content when it exists", async () => {
      seedFile("users/alice/settings.json", '{"theme":"dark"}');
      const mfs = createFsaMigrationFs();
      const content = await mfs.readFile("users/alice/settings.json");
      expect(content).toBe('{"theme":"dark"}');
    });

    it("throws when the file does not exist", async () => {
      const mfs = createFsaMigrationFs();
      await expect(mfs.readFile("missing/file.json")).rejects.toThrow(
        "migration-fs-fsa: file not found: missing/file.json"
      );
    });
  });

  // -- writeFile + exists round-trip ----------------------------------------

  describe("writeFile", () => {
    it("persists content and exists() returns true afterwards", async () => {
      const mfs = createFsaMigrationFs();
      expect(await mfs.exists("out/result.json")).toBe(false);
      await mfs.writeFile("out/result.json", '{"ok":true}');
      expect(await mfs.exists("out/result.json")).toBe(true);
      const back = await mfs.readFile("out/result.json");
      expect(back).toBe('{"ok":true}');
    });
  });

  // -- mkdirp ----------------------------------------------------------------

  describe("mkdirp", () => {
    it("creates the directory so fileExists returns true", async () => {
      const mfs = createFsaMigrationFs();
      expect(await mfs.exists("new/deep/dir")).toBe(false);
      await mfs.mkdirp("new/deep/dir");
      expect(await mfs.exists("new/deep/dir")).toBe(true);
    });

    it("is idempotent on an existing directory", async () => {
      seedDir("existing/dir");
      const mfs = createFsaMigrationFs();
      await expect(mfs.mkdirp("existing/dir")).resolves.toBeUndefined();
    });
  });

  // -- rename (directory subtree) -------------------------------------------

  describe("rename (directory)", () => {
    it("moves a directory subtree: files appear at destination, source is gone", async () => {
      // Seed:  users/bob/tasks/1.json   +   users/bob/settings.json
      seedFile("users/bob/tasks/1.json", '{"id":1}');
      seedFile("users/bob/settings.json", '{"user":"bob"}');

      const mfs = createFsaMigrationFs();
      await mfs.rename("users/bob", "_trash/bob");

      // Destination files must exist.
      expect(await mfs.exists("_trash/bob/tasks/1.json")).toBe(true);
      expect(await mfs.exists("_trash/bob/settings.json")).toBe(true);

      // Content must be preserved.
      expect(await mfs.readFile("_trash/bob/tasks/1.json")).toBe('{"id":1}');
      expect(await mfs.readFile("_trash/bob/settings.json")).toBe('{"user":"bob"}');

      // Source files must be gone.
      expect(await mfs.exists("users/bob/tasks/1.json")).toBe(false);
      expect(await mfs.exists("users/bob/settings.json")).toBe(false);
    });

    it("moves nested subdirectory content correctly", async () => {
      seedFile("users/carol/results/task-1/notes.md", "# notes");
      seedFile("users/carol/results/task-1/results.md", "# results");
      seedFile("users/carol/results/task-2/notes.md", "# task 2");

      const mfs = createFsaMigrationFs();
      await mfs.rename("users/carol", "_trash/carol");

      expect(await mfs.exists("_trash/carol/results/task-1/notes.md")).toBe(true);
      expect(await mfs.exists("_trash/carol/results/task-1/results.md")).toBe(true);
      expect(await mfs.exists("_trash/carol/results/task-2/notes.md")).toBe(true);

      expect(await mfs.exists("users/carol/results/task-1/notes.md")).toBe(false);
    });
  });

  // -- rename (single file) -------------------------------------------------

  describe("rename (file)", () => {
    it("moves a single file: destination exists, source is gone", async () => {
      seedFile("tmp/upload.json", '{"status":"pending"}');

      const mfs = createFsaMigrationFs();
      await mfs.rename("tmp/upload.json", "done/upload.json");

      expect(await mfs.exists("done/upload.json")).toBe(true);
      expect(await mfs.readFile("done/upload.json")).toBe('{"status":"pending"}');
      expect(await mfs.exists("tmp/upload.json")).toBe(false);
    });
  });
});
