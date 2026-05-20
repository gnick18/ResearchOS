/**
 * Lightweight File System Access API mock for component tests.
 *
 * CI environments and jsdom cannot drive `window.showDirectoryPicker()` or
 * the `FileSystemDirectoryHandle` family interactively. This module provides
 * an in-memory virtual file system that satisfies the surface our app uses
 * (file-service.ts, file-system-context.tsx).
 *
 * Two separate consumer surfaces, do not confuse them:
 *   - `src/lib/file-system/wiki-capture-mock.ts` is the runtime fixture
 *     installer for the `/demo` route (Playwright wiki screenshots). It
 *     mounts a populated FileService instance directly.
 *   - This module is a lower-level FSA shim for component-level vitest
 *     tests running under jsdom. Tests can call `seedVirtualFileSystem`
 *     to populate the tree, then mount a component that ends up calling
 *     `window.showDirectoryPicker()` or `FileSystemFileHandle.getFile()`.
 *
 * The shim:
 *   - exposes `seedVirtualFileSystem(tree)` and `resetVirtualFileSystem()`
 *   - installs `window.showDirectoryPicker` returning the root handle
 *   - implements directory + file handle methods our code actually uses
 *   - returns `granted` for permission queries
 *
 * Activated by importing this module from a test setup file. The default
 * test-setup.ts resets the virtual FS between tests.
 */

type FSEntryFile = { kind: "file"; contents: string | ArrayBuffer; lastModified?: number };
type FSEntryDir = { kind: "directory"; entries: Record<string, FSEntry> };
type FSEntry = FSEntryFile | FSEntryDir;

type FileTreeNode = string | Uint8Array | ArrayBuffer | { [key: string]: FileTreeNode };

let root: FSEntryDir = { kind: "directory", entries: {} };

function ensureDirOrFile(value: FileTreeNode): FSEntry {
  if (typeof value === "string") {
    return { kind: "file", contents: value, lastModified: Date.now() };
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return { kind: "file", contents: value instanceof Uint8Array ? value.buffer.slice(0) as ArrayBuffer : value, lastModified: Date.now() };
  }
  const dir: FSEntryDir = { kind: "directory", entries: {} };
  for (const [name, child] of Object.entries(value)) {
    dir.entries[name] = ensureDirOrFile(child);
  }
  return dir;
}

/**
 * Populate the virtual file system. Keys with "/" are flattened into nested
 * directories so callers can write:
 *   seedVirtualFileSystem({
 *     "users/GrantNickles/_onboarding.json": '{"mode":"suggestions"}',
 *     "users/GrantNickles/tasks/1.json": '{"id":1}',
 *   })
 */
export function seedVirtualFileSystem(tree: Record<string, FileTreeNode>): void {
  for (const [rawPath, value] of Object.entries(tree)) {
    const segments = rawPath.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let cursor: FSEntryDir = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const existing = cursor.entries[segment];
      if (!existing || existing.kind !== "directory") {
        const newDir: FSEntryDir = { kind: "directory", entries: {} };
        cursor.entries[segment] = newDir;
        cursor = newDir;
      } else {
        cursor = existing;
      }
    }
    cursor.entries[segments[segments.length - 1]] = ensureDirOrFile(value);
  }
}

export function resetVirtualFileSystem(): void {
  root = { kind: "directory", entries: {} };
}

class MockWritable {
  private chunks: (string | ArrayBuffer | Uint8Array)[] = [];
  constructor(private file: FSEntryFile) {}
  async write(chunk: string | ArrayBuffer | Uint8Array | Blob): Promise<void> {
    if (chunk instanceof Blob) {
      const buf = await chunk.arrayBuffer();
      this.chunks.push(buf);
    } else {
      this.chunks.push(chunk as string | ArrayBuffer | Uint8Array);
    }
  }
  async close(): Promise<void> {
    if (this.chunks.length === 0) return;
    if (this.chunks.every((c) => typeof c === "string")) {
      this.file.contents = (this.chunks as string[]).join("");
    } else {
      const parts: Uint8Array[] = this.chunks.map((c) => {
        if (typeof c === "string") return new TextEncoder().encode(c);
        if (c instanceof Uint8Array) return c;
        return new Uint8Array(c as ArrayBuffer);
      });
      const total = parts.reduce((acc, p) => acc + p.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.byteLength;
      }
      this.file.contents = merged.buffer.slice(0) as ArrayBuffer;
    }
    this.file.lastModified = Date.now();
  }
  async abort(): Promise<void> {
    this.chunks = [];
  }
}

class MockFileHandle {
  readonly kind = "file" as const;
  constructor(public name: string, private entry: FSEntryFile) {}
  async getFile(): Promise<File> {
    const content = this.entry.contents;
    const parts: BlobPart[] = typeof content === "string" ? [content] : [content];
    return new File(parts, this.name, { lastModified: this.entry.lastModified ?? Date.now() });
  }
  async createWritable(opts?: { keepExistingData?: boolean }): Promise<MockWritable> {
    if (!opts?.keepExistingData) {
      this.entry.contents = "";
    }
    return new MockWritable(this.entry);
  }
  async queryPermission(): Promise<"granted"> {
    return "granted";
  }
  async requestPermission(): Promise<"granted"> {
    return "granted";
  }
  async isSameEntry(other: MockFileHandle): Promise<boolean> {
    return other === this;
  }
}

class MockDirectoryHandle {
  readonly kind = "directory" as const;
  constructor(public name: string, private dir: FSEntryDir) {}

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFileHandle> {
    const existing = this.dir.entries[name];
    if (existing && existing.kind === "file") {
      return new MockFileHandle(name, existing);
    }
    if (existing && existing.kind === "directory") {
      throw new DOMException(`TypeMismatchError: ${name} is a directory`, "TypeMismatchError");
    }
    if (opts?.create) {
      const created: FSEntryFile = { kind: "file", contents: "", lastModified: Date.now() };
      this.dir.entries[name] = created;
      return new MockFileHandle(name, created);
    }
    throw new DOMException(`NotFoundError: ${name}`, "NotFoundError");
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirectoryHandle> {
    const existing = this.dir.entries[name];
    if (existing && existing.kind === "directory") {
      return new MockDirectoryHandle(name, existing);
    }
    if (existing && existing.kind === "file") {
      throw new DOMException(`TypeMismatchError: ${name} is a file`, "TypeMismatchError");
    }
    if (opts?.create) {
      const created: FSEntryDir = { kind: "directory", entries: {} };
      this.dir.entries[name] = created;
      return new MockDirectoryHandle(name, created);
    }
    throw new DOMException(`NotFoundError: ${name}`, "NotFoundError");
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const entry = this.dir.entries[name];
    if (!entry) {
      throw new DOMException(`NotFoundError: ${name}`, "NotFoundError");
    }
    if (entry.kind === "directory" && Object.keys(entry.entries).length > 0 && !opts?.recursive) {
      throw new DOMException(`InvalidModificationError: ${name} is not empty`, "InvalidModificationError");
    }
    delete this.dir.entries[name];
  }

  async *values(): AsyncIterableIterator<MockFileHandle | MockDirectoryHandle> {
    for (const [name, entry] of Object.entries(this.dir.entries)) {
      if (entry.kind === "file") {
        yield new MockFileHandle(name, entry);
      } else {
        yield new MockDirectoryHandle(name, entry);
      }
    }
  }

  async *entries(): AsyncIterableIterator<[string, MockFileHandle | MockDirectoryHandle]> {
    for (const [name, entry] of Object.entries(this.dir.entries)) {
      if (entry.kind === "file") {
        yield [name, new MockFileHandle(name, entry)];
      } else {
        yield [name, new MockDirectoryHandle(name, entry)];
      }
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of Object.keys(this.dir.entries)) {
      yield name;
    }
  }

  async queryPermission(): Promise<"granted"> {
    return "granted";
  }
  async requestPermission(): Promise<"granted"> {
    return "granted";
  }
  async isSameEntry(other: MockDirectoryHandle): Promise<boolean> {
    return other === this;
  }
}

/**
 * Get the synthetic root directory handle without going through the picker.
 * Useful for tests that want to inject the handle directly into a service.
 */
export function getMockRootDirectoryHandle(name = "MockRoot"): MockDirectoryHandle {
  return new MockDirectoryHandle(name, root);
}

/**
 * Install `window.showDirectoryPicker` so code paths that rely on the picker
 * (e.g. file-system-context.tsx's onConnectFolder) resolve to the virtual FS
 * without user gesture. Idempotent; call from setup or from a test's beforeAll.
 */
export function installShowDirectoryPickerMock(name = "MockRoot"): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
    return getMockRootDirectoryHandle(name);
  };
}
