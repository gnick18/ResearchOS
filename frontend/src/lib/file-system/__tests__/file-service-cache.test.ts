// Coverage for the two read-path optimizations layered on top of the FSA read
// cache:
//
//   1. Negative cache — a path that reads as missing/empty is remembered for
//      NEGATIVE_TTL_MS so the next read short-circuits to null WITHOUT another
//      FSA getFileHandle lookup (a NotFound round-trip on OneDrive). Local
//      writes clear it; deletes set it; it expires on TTL so an out-of-band
//      create still surfaces.
//
//   2. In-flight read coalescing — concurrent reads of the same path share one
//      underlying FSA+IndexedDB round-trip (collapses the staleTime:0 re-read
//      storm), clearing the moment the read settles so a read-after-write is
//      still fresh.
//
// These assertions sit ABOVE the IndexedDB layer (initDB() returns null under
// vitest, so every read MISSes at the IDB tier and falls through to FSA).
// They count FSA handle lookups / getFile calls on a minimal in-memory mock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileService } from "../file-service";

// ── Instrumented in-memory FSA mock ─────────────────────────────────────────

let handleLookups = 0; // getDirectoryHandle + getFileHandle calls (FSA traversal)
const getFileCalls = new Map<string, number>();
let readGate: Promise<void> | null = null; // when set, getFile awaits it (forces overlap)

class MFile {
  kind = "file" as const;
  lastModified = 1000;
  constructor(public name: string, public bytes: Uint8Array) {}

  async getFile() {
    getFileCalls.set(this.name, (getFileCalls.get(this.name) ?? 0) + 1);
    if (readGate) await readGate;
    const bytes = this.bytes;
    return {
      lastModified: this.lastModified,
      size: bytes.byteLength,
      type: "",
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as File;
  }

  async createWritable() {
    let buf = new Uint8Array(0);
    return {
      async write(payload: string | Blob | ArrayBuffer | Uint8Array) {
        if (typeof payload === "string") buf = new TextEncoder().encode(payload);
        else if (payload instanceof Uint8Array) buf = new Uint8Array(payload);
        else if (payload instanceof ArrayBuffer) buf = new Uint8Array(payload);
        else buf = new Uint8Array(await (payload as Blob).arrayBuffer());
      },
      close: async () => {
        this.bytes = buf;
        this.lastModified += 1; // mtime advances on write
      },
      async abort() {},
    };
  }

  // Atomic rename: re-home into parent under newName.
  move = async (parent: MDir, newName: string) => {
    parent.entries.delete(this.name);
    this.name = newName;
    parent.entries.set(newName, this);
  };
}

class MDir {
  kind = "directory" as const;
  entries = new Map<string, MFile | MDir>();
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    handleLookups++;
    const existing = this.entries.get(name);
    if (existing && existing.kind === "directory") return existing;
    if (existing) throw new Error("Not a directory: " + name);
    if (!opts?.create) throw new Error("NotFound dir: " + name);
    const dir = new MDir(name);
    this.entries.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    handleLookups++;
    const existing = this.entries.get(name);
    if (existing && existing.kind === "file") return existing;
    if (existing) throw new Error("Not a file: " + name);
    if (!opts?.create) throw new Error("NotFound file: " + name);
    const file = new MFile(name, new Uint8Array(0));
    this.entries.set(name, file);
    return file;
  }

  async removeEntry(name: string) {
    if (!this.entries.has(name)) throw new Error("NotFound: " + name);
    this.entries.delete(name);
  }
}

let service: FileService;
let root: MDir;

beforeEach(() => {
  handleLookups = 0;
  getFileCalls.clear();
  readGate = null;
  root = new MDir("root");
  service = new FileService();
  service.setDirectoryHandle(root as unknown as FileSystemDirectoryHandle);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Negative cache ───────────────────────────────────────────────────────────

describe("negative cache", () => {
  it("short-circuits a repeated read of a missing file (no second FSA lookup)", async () => {
    expect(await service.readJson("users/alex/missing.json")).toBeNull();
    const afterFirst = handleLookups;
    expect(afterFirst).toBeGreaterThan(0); // first read DID hit FSA

    expect(await service.readJson("users/alex/missing.json")).toBeNull();
    expect(handleLookups).toBe(afterFirst); // second read short-circuited
  });

  it("applies across reader kinds (blob read short-circuits too)", async () => {
    expect(await service.readJson("users/alex/x.png.json")).toBeNull();
    const afterJson = handleLookups;
    // A blob read of the SAME path also short-circuits via the shared set.
    expect(await service.readFileAsBlob("users/alex/x.png.json")).toBeNull();
    expect(handleLookups).toBe(afterJson);
  });

  it("a write invalidates the negative entry so the next read sees the value", async () => {
    expect(await service.readJson("users/alex/late.json")).toBeNull();
    await service.writeJson("users/alex/late.json", { v: 7 });
    // Must NOT short-circuit — the write cleared the negative entry.
    expect(await service.readJson<{ v: number }>("users/alex/late.json")).toEqual({ v: 7 });
  });

  it("a delete marks the path missing so the next read short-circuits", async () => {
    await service.writeJson("users/alex/gone.json", { v: 1 });
    expect(await service.readJson("users/alex/gone.json")).toEqual({ v: 1 });

    expect(await service.deleteFile("users/alex/gone.json")).toBe(true);
    const before = handleLookups;
    expect(await service.readJson("users/alex/gone.json")).toBeNull();
    expect(handleLookups).toBe(before); // short-circuited, no FSA re-probe
  });

  it("expires after the TTL so an out-of-band create still surfaces", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    expect(await service.readJson("users/alex/eventual.json")).toBeNull();
    const afterMiss = handleLookups;

    // Simulate an out-of-band create (collaborator write the local service
    // never saw, so no clearMissing fired).
    const usersDir = await root.getDirectoryHandle("users", { create: true });
    const alexDir = await usersDir.getDirectoryHandle("alex", { create: true });
    const f = await alexDir.getFileHandle("eventual.json", { create: true });
    (f as MFile).bytes = new TextEncoder().encode(JSON.stringify({ v: 99 }));
    const lookupsBeforeTtl = handleLookups;

    // Within the TTL window: still short-circuited to null.
    expect(await service.readJson("users/alex/eventual.json")).toBeNull();
    expect(handleLookups).toBe(lookupsBeforeTtl);

    // Past the TTL: re-probes FSA and now finds the file.
    vi.setSystemTime(31_000);
    expect(await service.readJson<{ v: number }>("users/alex/eventual.json")).toEqual({ v: 99 });
    expect(handleLookups).toBeGreaterThan(afterMiss);
  });

  it("does not leak across a folder switch", async () => {
    expect(await service.readJson("users/alex/missing.json")).toBeNull();
    const before = handleLookups;
    // Reconnect / switch to a fresh folder must reset the negative set.
    service.setDirectoryHandle(new MDir("other") as unknown as FileSystemDirectoryHandle);
    expect(await service.readJson("users/alex/missing.json")).toBeNull();
    expect(handleLookups).toBeGreaterThan(before); // re-probed, not short-circuited
  });
});

// ── In-flight coalescing ─────────────────────────────────────────────────────

describe("in-flight read coalescing", () => {
  it("collapses concurrent reads of the same path into one getFile()", async () => {
    await service.writeJson("users/alex/seq.json", { v: 1 });
    getFileCalls.clear();

    // Gate getFile so all five reads overlap before any resolves.
    let release!: () => void;
    readGate = new Promise<void>((r) => (release = r));

    const reads = Promise.all(
      Array.from({ length: 5 }, () => service.readJson<{ v: number }>("users/alex/seq.json"))
    );
    await Promise.resolve(); // let the reads register their in-flight promise
    release();

    const results = await reads;
    expect(results).toEqual([{ v: 1 }, { v: 1 }, { v: 1 }, { v: 1 }, { v: 1 }]);
    expect(getFileCalls.get("seq.json")).toBe(1); // five callers, one FSA read
  });

  it("does not coalesce sequential reads (read-after-write stays fresh)", async () => {
    await service.writeJson("users/alex/seq.json", { v: 1 });
    expect(await service.readJson<{ v: number }>("users/alex/seq.json")).toEqual({ v: 1 });

    await service.writeJson("users/alex/seq.json", { v: 2 });
    // A later read is a brand-new in-flight entry: must reflect the new write.
    expect(await service.readJson<{ v: number }>("users/alex/seq.json")).toEqual({ v: 2 });
  });
});
