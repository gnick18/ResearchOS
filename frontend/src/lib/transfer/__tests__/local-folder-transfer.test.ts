// Cross-folder COPY (Strategy A) coverage. Two in-memory FileService instances
// stand in for the SOURCE folder (the module singleton) and a DESTINATION
// folder (a second instance). A note with an image attachment is collected in
// the source and materialized into the destination via the destination-scoped
// write path.
//
// Invariants asserted:
//   1. The destination note gets a FRESH id from the DESTINATION's own
//      _counters.json (NOT the source counter).
//   2. The attachment binary is carried byte-for-byte into the destination.
//   3. The SOURCE note + its attachment are unchanged after the copy.
//   4. An embedded-object reference in the body is carried verbatim (v1 keeps
//      embeds as-is, no re-import).
//   5. A member-folder destination is REFUSED (addendum C7).
//
// The in-memory FSA mock supports values()/move()/getFile() so both the collect
// path (listFiles + readFileAsBlob on the singleton) and the materialize path
// (createForUser + writeFileFromBlob on the second instance) run unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileService, fileService } from "@/lib/file-system/file-service";
import type { Note } from "@/lib/types";

// ── In-memory FSA mock ──────────────────────────────────────────────────────

class MockWritable {
  private buf: Uint8Array = new Uint8Array(0);
  constructor(private readonly file: MockFile) {}
  async write(payload: string | Blob | ArrayBuffer | Uint8Array): Promise<void> {
    if (typeof payload === "string") {
      this.buf = new TextEncoder().encode(payload);
    } else if (payload instanceof Uint8Array) {
      this.buf = payload;
    } else if (payload instanceof ArrayBuffer) {
      this.buf = new Uint8Array(payload);
    } else {
      const ab = await (payload as Blob).arrayBuffer();
      this.buf = new Uint8Array(ab);
    }
  }
  async close(): Promise<void> {
    this.file.bytes = this.buf;
    this.file.lastModified = Date.now() + MockFile.tick();
  }
  async abort(): Promise<void> {
    /* discard */
  }
}

class MockFile {
  kind = "file" as const;
  bytes: Uint8Array = new Uint8Array(0);
  lastModified = 0;
  private static counter = 0;
  static tick(): number {
    return ++MockFile.counter;
  }
  constructor(public name: string) {}

  async getFile(): Promise<Blob & { lastModified: number; text: () => Promise<string> }> {
    const bytes = this.bytes;
    const lm = this.lastModified;
    return {
      size: bytes.byteLength,
      type: "",
      lastModified: lm,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => new TextDecoder().decode(bytes),
      slice: () => new Blob(),
      stream: () => new ReadableStream(),
    } as unknown as Blob & { lastModified: number; text: () => Promise<string> };
  }

  async createWritable(): Promise<MockWritable> {
    return new MockWritable(this);
  }

  async move(parent: MockDirectory, newName: string): Promise<void> {
    const old = parent.entries.get(this.name);
    if (old === this) parent.entries.delete(this.name);
    this.name = newName;
    parent.entries.set(newName, this);
  }
}

class MockDirectory {
  kind = "directory" as const;
  entries = new Map<string, MockFile | MockDirectory>();
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirectory> {
    const existing = this.entries.get(name);
    if (existing && existing.kind === "directory") return existing;
    if (existing) throw new Error("Not a directory: " + name);
    if (!opts?.create) throw new Error("NotFoundError: " + name);
    const dir = new MockDirectory(name);
    this.entries.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFile> {
    const existing = this.entries.get(name);
    if (existing && existing.kind === "file") return existing;
    if (existing) throw new Error("Not a file: " + name);
    if (!opts?.create) throw new Error("NotFoundError: " + name);
    const file = new MockFile(name);
    this.entries.set(name, file);
    return file;
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    if (!this.entries.has(name)) throw new Error("NotFoundError: " + name);
    void opts;
    this.entries.delete(name);
  }

  async *values(): AsyncIterable<MockFile | MockDirectory> {
    for (const entry of this.entries.values()) {
      yield entry;
    }
  }
}

function makeService(root: MockDirectory): FileService {
  const svc = new FileService();
  svc.setDirectoryHandle(root as unknown as FileSystemDirectoryHandle);
  return svc;
}

// Seed a path's JSON content directly into the mock tree (bypassing the cache
// write-through so reads exercise the real readJson path).
async function seedJson(root: MockDirectory, path: string, data: unknown): Promise<void> {
  await writeRaw(root, path, new TextEncoder().encode(JSON.stringify(data, null, 2)));
}
async function seedBytes(root: MockDirectory, path: string, bytes: Uint8Array): Promise<void> {
  await writeRaw(root, path, bytes);
}
async function writeRaw(root: MockDirectory, path: string, bytes: Uint8Array): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop()!;
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  const fh = await dir.getFileHandle(fileName, { create: true });
  fh.bytes = bytes;
  fh.lastModified = Date.now() + MockFile.tick();
}

function readRaw(root: MockDirectory, path: string): Uint8Array | null {
  const parts = path.split("/").filter(Boolean);
  let dir: MockDirectory = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = dir.entries.get(parts[i]);
    if (!next || next.kind !== "directory") return null;
    dir = next;
  }
  const f = dir.entries.get(parts[parts.length - 1]);
  if (!f || f.kind !== "file") return null;
  return f.bytes;
}
function readRawJson(root: MockDirectory, path: string): unknown | null {
  const bytes = readRaw(root, path);
  if (!bytes) return null;
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ── Module mocks ────────────────────────────────────────────────────────────
// readSharingIdentity hits IndexedDB; stub it to "no identity" so the collect
// ships a sender-free bundle (the copy path does not need a verified sender).
vi.mock("@/lib/sharing/identity/sidecar", () => ({
  readSharingIdentity: vi.fn(async () => null),
}));

// Import AFTER vi.mock so the mock is in place.
import {
  copyObjectToFolder,
  resolveDestinationUsername,
  isEligibleDestination,
  CrossFolderCopyError,
} from "../local-folder-transfer";
import * as idb from "@/lib/file-system/indexeddb-store";

// ── Fixtures ────────────────────────────────────────────────────────────────

const SOURCE_USER = "alice";
const DEST_USER = "bob";
const ATTACHMENT_BYTES = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]);
const EMBED_HREF = "/methods/7#ros=card";

function makeSourceNote(): Note {
  return {
    id: 5,
    title: "Crystal prep",
    description: "A note to copy",
    is_running_log: false,
    is_shared: false,
    entries: [
      {
        id: "e1",
        title: "Step 1",
        date: "2026-06-19",
        content: `See ![](Images/crystal.png) and [method](${EMBED_HREF})`,
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
      },
    ],
    comments: [],
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z",
    username: SOURCE_USER,
  } as Note;
}

let sourceRoot: MockDirectory;
let destRoot: MockDirectory;
let destHandle: MockDirectory;

beforeEach(async () => {
  MockFile["counter" as unknown as keyof typeof MockFile] = 0 as never;
  sourceRoot = new MockDirectory("source");
  destRoot = new MockDirectory("dest");
  destHandle = destRoot;

  // Bind the SINGLETON to the source folder (the collect reads from it).
  fileService.setDirectoryHandle(sourceRoot as unknown as FileSystemDirectoryHandle);

  // Seed the source note's attachment + the source counter at 5.
  await seedBytes(
    sourceRoot,
    `users/${SOURCE_USER}/notes/5/Images/crystal.png`,
    ATTACHMENT_BYTES,
  );
  await seedJson(sourceRoot, `users/${SOURCE_USER}/_counters.json`, { notes: 5 });

  // Seed the DESTINATION folder: a Main user pin + a pre-existing notes counter
  // at 41, so a fresh id must be 42 (proving it comes from the DEST counter).
  await seedJson(destRoot, "users/_user_metadata.json", { main_user: DEST_USER });
  await seedJson(destRoot, `users/${DEST_USER}/_counters.json`, { notes: 41 });
});

afterEach(() => {
  vi.restoreAllMocks();
  fileService.clearDirectoryHandle();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("resolveDestinationUsername", () => {
  it("prefers the per-folder Main pin", async () => {
    const dest = makeService(destRoot);
    expect(await resolveDestinationUsername(dest)).toBe(DEST_USER);
  });

  it("falls back to the single user directory when no Main is pinned", async () => {
    const root = new MockDirectory("d2");
    await seedJson(root, `users/charlie/_counters.json`, { notes: 0 });
    const dest = makeService(root);
    expect(await resolveDestinationUsername(dest)).toBe("charlie");
  });
});

describe("isEligibleDestination", () => {
  it("refuses the active folder and member folders, allows the rest", () => {
    const base = { name: "F", lastOpenedAt: 0, handle: {} as FileSystemDirectoryHandle };
    expect(isEligibleDestination({ id: "active", ...base }, "active")).toBe(false);
    expect(
      isEligibleDestination({ id: "joined", labRole: "member", ...base }, "active"),
    ).toBe(false);
    expect(isEligibleDestination({ id: "mine", labRole: "head", ...base }, "active")).toBe(
      true,
    );
    expect(isEligibleDestination({ id: "solo", ...base }, "active")).toBe(true);
  });
});

describe("copyObjectToFolder", () => {
  function stubRegistry(folder: {
    id: string;
    labRole?: idb.RememberedFolderLabRole;
  }): void {
    vi.spyOn(idb, "getActiveFolderId").mockResolvedValue("active-folder");
    vi.spyOn(idb, "listRememberedFolders").mockResolvedValue([
      {
        id: folder.id,
        name: "Destination",
        lastOpenedAt: 1,
        handle: destHandle as unknown as FileSystemDirectoryHandle,
        ...(folder.labRole ? { labRole: folder.labRole } : {}),
      },
    ]);
    vi.spyOn(idb, "getRememberedFolderHandle").mockResolvedValue(
      destHandle as unknown as FileSystemDirectoryHandle,
    );
  }

  it("materializes a fresh-id copy with the attachment, leaving the source untouched", async () => {
    stubRegistry({ id: "dest-folder", labRole: "head" });
    const note = makeSourceNote();

    const { noteId, destUsername } = await copyObjectToFolder(note, SOURCE_USER, "dest-folder");

    // 1. Fresh id from the DESTINATION counter (41 -> 42), not the source (5).
    expect(noteId).toBe(42);
    expect(destUsername).toBe(DEST_USER);
    const destCounters = readRawJson(destRoot, `users/${DEST_USER}/_counters.json`) as {
      notes: number;
    };
    expect(destCounters.notes).toBe(42);

    // The destination note record exists under the DEST user with the new id.
    const destNote = readRawJson(
      destRoot,
      `users/${DEST_USER}/notes/42.json`,
    ) as Note;
    expect(destNote).toBeTruthy();
    expect(destNote.id).toBe(42);
    expect(destNote.title).toBe("Crystal prep");
    expect(destNote.username).toBe(DEST_USER);
    // 4. Embedded-object reference carried verbatim (v1: no re-import/rewrite).
    expect(destNote.entries[0].content).toContain(EMBED_HREF);
    expect(destNote.entries[0].content).toContain("Images/crystal.png");

    // 2. Attachment binary carried byte-for-byte into the destination.
    const destImg = readRaw(destRoot, `users/${DEST_USER}/notes/42/Images/crystal.png`);
    expect(destImg).not.toBeNull();
    expect(Array.from(destImg!)).toEqual(Array.from(ATTACHMENT_BYTES));

    // 3. SOURCE note + attachment unchanged. The source counter stays at 5 and
    // no note record was written into the source for this copy.
    const srcCounters = readRawJson(sourceRoot, `users/${SOURCE_USER}/_counters.json`) as {
      notes: number;
    };
    expect(srcCounters.notes).toBe(5);
    const srcImg = readRaw(
      sourceRoot,
      `users/${SOURCE_USER}/notes/5/Images/crystal.png`,
    );
    expect(Array.from(srcImg!)).toEqual(Array.from(ATTACHMENT_BYTES));
    // No id-42 note leaked into the source folder.
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/notes/42.json`)).toBeNull();
  });

  it("refuses a member-folder destination (addendum C7)", async () => {
    stubRegistry({ id: "dest-folder", labRole: "member" });
    const note = makeSourceNote();

    await expect(copyObjectToFolder(note, SOURCE_USER, "dest-folder")).rejects.toBeInstanceOf(
      CrossFolderCopyError,
    );

    // Nothing was written into the destination.
    expect(readRaw(destRoot, `users/${DEST_USER}/notes/42.json`)).toBeNull();
  });
});
