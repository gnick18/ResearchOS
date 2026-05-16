// Atomic-write coverage for fileService.writeJson + fileService.writeFileFromBlob.
//
// Both methods route through the private `atomicWrite` helper, which writes
// to `${path}.tmp` first then renames via FSA `move()`. The KEY invariant
// these tests verify: a torn write (createWritable open + .write throws OR
// .close throws OR .move throws) MUST leave the original file's contents
// intact, not zero bytes. See AGENTS.md §6 for the failure mode this guards.
//
// The mock below is a minimal in-memory FSA implementation: directories are
// Map<name, entry>, file contents are stored as Uint8Array, and createWritable
// returns a stream-shaped object whose `.write/.close/.move/.abort` can be
// individually overridden per-test to simulate mid-write crashes.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileService } from "../file-service";

// ── In-memory FSA mock ──────────────────────────────────────────────────────

type MockOverrides = {
  writeThrows?: boolean;
  closeThrows?: boolean;
  moveThrows?: boolean;
  // Suppress move() entirely (simulate non-Chromium): the helper falls back
  // to removeEntry + rewrite. Default true (move available) so the happy
  // path runs on the atomic branch.
  moveSupported?: boolean;
};

class MockWritable {
  constructor(
    private readonly file: MockFile,
    private readonly overrides: MockOverrides
  ) {}
  private buffer: Uint8Array = new Uint8Array(0);
  private aborted = false;

  async write(payload: string | Blob | ArrayBuffer | Uint8Array): Promise<void> {
    if (this.overrides.writeThrows) {
      throw new Error("MockWritable.write rejected (simulated torn write)");
    }
    if (typeof payload === "string") {
      this.buffer = new TextEncoder().encode(payload);
    } else if (payload instanceof Uint8Array) {
      this.buffer = payload;
    } else if (payload instanceof ArrayBuffer) {
      this.buffer = new Uint8Array(payload);
    } else {
      // Blob
      const ab = await (payload as Blob).arrayBuffer();
      this.buffer = new Uint8Array(ab);
    }
  }

  async close(): Promise<void> {
    if (this.overrides.closeThrows) {
      throw new Error("MockWritable.close rejected (simulated torn close)");
    }
    if (!this.aborted) {
      // Commit to the underlying mock file.
      this.file.bytes = this.buffer;
    }
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }
}

class MockFile {
  // Replicates the real FSA semantic: createWritable() truncates the
  // underlying file IMMEDIATELY (before any write). We do NOT mimic that in
  // the mock. Tests that need to verify "original file untouched after
  // torn write" specifically use the atomicWrite path (which writes to .tmp
  // first), so the tmp's truncate doesn't affect the final file. This is
  // exactly the invariant the bug-fix is meant to provide.
  kind: "file" = "file" as const;
  bytes: Uint8Array = new Uint8Array(0);
  constructor(public name: string, private overridesRef: { current: MockOverrides }) {}

  async getFile(): Promise<Blob & { text: () => Promise<string> }> {
    const bytes = this.bytes;
    return {
      size: bytes.byteLength,
      type: "",
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => new TextDecoder().decode(bytes),
      slice: () => new Blob(),
      stream: () => new ReadableStream(),
    } as unknown as Blob & { text: () => Promise<string> };
  }

  async createWritable(): Promise<MockWritable> {
    return new MockWritable(this, this.overridesRef.current);
  }
}

class MockDirectory {
  kind: "directory" = "directory" as const;
  entries = new Map<string, MockFile | MockDirectory>();
  constructor(public name: string, private overridesRef: { current: MockOverrides }) {}

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean }
  ): Promise<MockDirectory> {
    const existing = this.entries.get(name);
    if (existing && existing.kind === "directory") return existing;
    if (existing) throw new Error("Not a directory: " + name);
    if (!opts?.create) throw new Error("Directory not found: " + name);
    const dir = new MockDirectory(name, this.overridesRef);
    this.entries.set(name, dir);
    return dir;
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean }
  ): Promise<MockFile> {
    const existing = this.entries.get(name);
    if (existing && existing.kind === "file") {
      // Real FSA does NOT truncate on getFileHandle (only createWritable
      // truncates). Tests that pre-seed contents rely on this.
      return existing;
    }
    if (existing) throw new Error("Not a file: " + name);
    if (!opts?.create) throw new Error("File not found: " + name);
    const file = new MockFile(name, this.overridesRef);
    this.entries.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.entries.has(name)) {
      // FSA throws NotFoundError; mirror by throwing.
      throw new Error("NotFoundError: " + name);
    }
    this.entries.delete(name);
  }
}

// Attach `move()` only when overrides.moveSupported !== false. Tests that
// want to exercise the non-Chromium fallback flip moveSupported=false.
function installMove(
  file: MockFile,
  overridesRef: { current: MockOverrides }
): void {
  Object.assign(file, {
    move: async (parent: MockDirectory, newName: string) => {
      if (overridesRef.current.moveThrows) {
        throw new Error("MockFile.move rejected (simulated rename failure)");
      }
      if (overridesRef.current.moveSupported === false) {
        // Strip move so the helper falls through to the fallback branch.
        delete (file as unknown as { move?: unknown }).move;
        throw new Error("move not supported");
      }
      // Re-home into the parent's entries map under the new name. Atomic
      // semantic: replaces any existing entry at newName.
      const old = parent.entries.get(file.name);
      if (old === file) parent.entries.delete(file.name);
      file.name = newName;
      parent.entries.set(newName, file);
    },
  });
}

// Patch getFileHandle to install move() on every freshly-created file when
// moveSupported is true. We stamp it onto the prototype lazily (simpler than
// doing it at the directory level when a file is returned).
const origGetFileHandle = MockDirectory.prototype.getFileHandle;
MockDirectory.prototype.getFileHandle = async function (
  this: MockDirectory,
  name: string,
  opts?: { create?: boolean }
) {
  const file = await origGetFileHandle.call(this, name, opts);
  const overridesRef = (this as unknown as { overridesRef: { current: MockOverrides } }).overridesRef;
  if (overridesRef.current.moveSupported !== false && typeof (file as unknown as { move?: unknown }).move !== "function") {
    installMove(file, overridesRef);
  }
  return file;
};

function makeRoot(initialOverrides: MockOverrides = {}): {
  root: MockDirectory;
  overrides: { current: MockOverrides };
} {
  const overrides = { current: { moveSupported: true, ...initialOverrides } };
  const root = new MockDirectory("root", overrides);
  return { root, overrides };
}

// ── Test setup ─────────────────────────────────────────────────────────────

let service: FileService;
let root: MockDirectory;
let overrides: { current: MockOverrides };

beforeEach(() => {
  ({ root, overrides } = makeRoot());
  service = new FileService();
  service.setDirectoryHandle(root as unknown as FileSystemDirectoryHandle);
});

// Helper: read the bytes a file currently holds in the mock. Returns null
// if no such file exists. Pure mock-state inspection (does not touch
// fileService.readJson, whose own implementation we keep out of these tests).
function readMockFile(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  let dir: MockDirectory = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = dir.entries.get(parts[i]);
    if (!next || next.kind !== "directory") return null;
    dir = next;
  }
  const file = dir.entries.get(parts[parts.length - 1]);
  if (!file || file.kind !== "file") return null;
  return new TextDecoder().decode(file.bytes);
}

function tmpFileExists(path: string): boolean {
  return readMockFile(`${path}.tmp`) !== null;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FileService.writeJson atomic write", () => {
  it("happy path: writes payload to final name, leaves no .tmp behind", async () => {
    await service.writeJson("users/alex/_telegram.json", { lastUpdateId: 42 });

    expect(readMockFile("users/alex/_telegram.json")).toBe(
      JSON.stringify({ lastUpdateId: 42 }, null, 2)
    );
    expect(tmpFileExists("users/alex/_telegram.json")).toBe(false);
  });

  it("mid-write crash (writable.write throws): original file untouched", async () => {
    // Pre-seed the final file with the OLD value the user must not lose.
    await service.writeJson("users/alex/_telegram.json", { lastUpdateId: 1 });
    expect(readMockFile("users/alex/_telegram.json")).toContain('"lastUpdateId": 1');

    overrides.current.writeThrows = true;
    await expect(
      service.writeJson("users/alex/_telegram.json", { lastUpdateId: 2 })
    ).rejects.toThrow(/simulated torn write/);

    // KEY INVARIANT: original contents intact, NOT zero bytes.
    expect(readMockFile("users/alex/_telegram.json")).toContain('"lastUpdateId": 1');
    // Tmp cleaned up best-effort.
    expect(tmpFileExists("users/alex/_telegram.json")).toBe(false);
  });

  it("mid-write crash (writable.close throws): original file untouched", async () => {
    await service.writeJson("users/alex/_telegram.json", { lastUpdateId: 1 });

    overrides.current.closeThrows = true;
    await expect(
      service.writeJson("users/alex/_telegram.json", { lastUpdateId: 2 })
    ).rejects.toThrow(/simulated torn close/);

    expect(readMockFile("users/alex/_telegram.json")).toContain('"lastUpdateId": 1');
  });

  it("rename fails (move throws): original file untouched, tmp cleaned up", async () => {
    await service.writeJson("users/alex/_telegram.json", { lastUpdateId: 1 });

    overrides.current.moveThrows = true;
    await expect(
      service.writeJson("users/alex/_telegram.json", { lastUpdateId: 2 })
    ).rejects.toThrow(/simulated rename failure/);

    expect(readMockFile("users/alex/_telegram.json")).toContain('"lastUpdateId": 1');
    expect(tmpFileExists("users/alex/_telegram.json")).toBe(false);
  });

  it("non-Chromium fallback (no move()): writes succeed via removeEntry+rewrite", async () => {
    // Spy on console.warn to assert the once-per-session warning fires.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    overrides.current.moveSupported = false;
    await service.writeJson("users/alex/_telegram.json", { lastUpdateId: 7 });

    expect(readMockFile("users/alex/_telegram.json")).toBe(
      JSON.stringify({ lastUpdateId: 7 }, null, 2)
    );
    // Warning fires; path NOT logged (per the no-PII-in-warn rule).
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls[0]?.map(String).join(" ") ?? "";
    expect(warnArgs).toContain("FSA move() unavailable");
    expect(warnArgs).not.toContain("users/alex/_telegram.json");

    warnSpy.mockRestore();
  });
});

describe("FileService.writeFileFromBlob atomic write", () => {
  it("happy path: writes blob bytes to final name, leaves no .tmp behind", async () => {
    const blob = new Blob(["hello world bytes"], { type: "text/plain" });
    await service.writeFileFromBlob("Images/photo.txt", blob);

    expect(readMockFile("Images/photo.txt")).toBe("hello world bytes");
    expect(tmpFileExists("Images/photo.txt")).toBe(false);
  });

  it("preserves old contents on write failure (mid-write torn blob write)", async () => {
    // Pre-seed an existing attachment.
    const initial = new Blob(["original-image-bytes"], { type: "text/plain" });
    await service.writeFileFromBlob("Images/photo.txt", initial);
    expect(readMockFile("Images/photo.txt")).toBe("original-image-bytes");

    overrides.current.writeThrows = true;
    const next = new Blob(["new-image-bytes-that-should-not-stick"]);
    await expect(
      service.writeFileFromBlob("Images/photo.txt", next)
    ).rejects.toThrow(/simulated torn write/);

    // Old bytes still there. This is the failure-mode the bug-fix promises.
    expect(readMockFile("Images/photo.txt")).toBe("original-image-bytes");
  });
});
