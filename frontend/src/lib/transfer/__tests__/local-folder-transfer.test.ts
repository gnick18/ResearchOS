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

// The MOVE + BULK source delete goes through the per-entity trashing delete APIs
// (notesApi / sequencesApi / calculatorsApi). Those run the full real trash
// dispatcher, which is covered by its own tests; here we control them so the
// test focuses on the cross-folder ORDERING + VERIFICATION logic (copy-then-
// delete, verify-source-gone, dest-failure leaves source intact). The collect
// builders never call these (they read the detail object passed in), and the
// cross-folder materialize uses the store layer directly, so mocking only the
// three delete/get surfaces is safe.
const deletedNotes = new Set<number>();
const deletedSeqs = new Set<number>();
const deletedCalcs = new Set<number>();
vi.mock("@/lib/local-api", () => ({
  notesApi: {
    delete: vi.fn(async (id: number) => {
      deletedNotes.add(id);
    }),
    get: vi.fn(async (id: number) => (deletedNotes.has(id) ? null : { id })),
  },
  sequencesApi: {
    delete: vi.fn(async (id: number) => {
      deletedSeqs.add(id);
    }),
    get: vi.fn(async (id: number) => (deletedSeqs.has(id) ? null : { id })),
  },
  calculatorsApi: {
    delete: vi.fn(async (id: number) => {
      deletedCalcs.add(id);
    }),
    get: vi.fn(async (id: number) => (deletedCalcs.has(id) ? null : { id })),
  },
}));

// Import AFTER vi.mock so the mock is in place.
import {
  copyObjectToFolder,
  moveObjectToFolder,
  bulkTransfer,
  resolveDestinationUsername,
  isEligibleDestination,
  CrossFolderCopyError,
  SourceNotRemovedError,
  type TransferTarget,
} from "../local-folder-transfer";
import * as idb from "@/lib/file-system/indexeddb-store";
import type { SequenceDetail, CustomCalculator } from "@/lib/types";

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

const GENBANK_TEXT =
  "LOCUS       seq1  10 bp  DNA  linear  19-JUN-2026\nORIGIN\n        1 acgtacgtac\n//\n";

function makeSourceSequence(): SequenceDetail {
  return {
    id: 9,
    display_name: "Plasmid pTest",
    seq_type: "dna",
    circular: false,
    genbank: GENBANK_TEXT,
    // The remaining SequenceDetail fields are not read by the collect (which
    // only carries genbank + display_name + seq_type + circular), so cast a
    // minimal object through unknown.
  } as unknown as SequenceDetail;
}

function makeSourceCalculator(): CustomCalculator {
  return {
    id: 3,
    name: "Molarity calc",
    description: "c1v1 = c2v2",
    inputs: [],
    steps: [],
    conditionals: [],
    outputs: [{ id: "o1", label: "result", expression: "1" }],
    shared_with: [],
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z",
  } as unknown as CustomCalculator;
}

let sourceRoot: MockDirectory;
let destRoot: MockDirectory;
let destHandle: MockDirectory;

// Shared registry stub: one remembered DESTINATION folder bound to destHandle,
// the active folder a distinct id. Uses vi.spyOn so afterEach restores it.
function stubDestRegistry(
  destFolderId: string,
  labRole?: idb.RememberedFolderLabRole,
): void {
  vi.spyOn(idb, "getActiveFolderId").mockResolvedValue("active-folder");
  vi.spyOn(idb, "listRememberedFolders").mockResolvedValue([
    {
      id: destFolderId,
      name: "Destination",
      lastOpenedAt: 1,
      handle: destHandle as unknown as FileSystemDirectoryHandle,
      ...(labRole ? { labRole } : {}),
    },
  ]);
  vi.spyOn(idb, "getRememberedFolderHandle").mockResolvedValue(
    destHandle as unknown as FileSystemDirectoryHandle,
  );
}

beforeEach(async () => {
  MockFile["counter" as unknown as keyof typeof MockFile] = 0 as never;
  deletedNotes.clear();
  deletedSeqs.clear();
  deletedCalcs.clear();
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
  // at 41, so a fresh id must be 42 (proving it comes from the DEST counter). The
  // sequence + calculator counters start unset so a first copy lands id 1.
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

// ── Stage 2: other supported types (sequence, calculator) ─────────────────────

describe("copyObjectToFolder, other supported types", () => {
  it("copies a SEQUENCE into the destination with a fresh id + carried GenBank, source untouched", async () => {
    stubDestRegistry("dest-folder", "head");
    const seq = makeSourceSequence();
    const target: TransferTarget = {
      kind: "sequence",
      sequence: seq,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await copyObjectToFolder(target, "dest-folder");

    // Fresh id from the DESTINATION counters (unset -> 1).
    expect(outcome.kind).toBe("sequence");
    expect(outcome.destId).toBe(1);
    expect(outcome.destUsername).toBe(DEST_USER);

    // The .gb source-of-truth + the .meta.json sidecar landed in the destination.
    const gb = readRaw(destRoot, `users/${DEST_USER}/sequences/1.gb`);
    expect(gb).not.toBeNull();
    expect(new TextDecoder().decode(gb!)).toBe(GENBANK_TEXT);
    const meta = readRawJson(
      destRoot,
      `users/${DEST_USER}/sequences/1.meta.json`,
    ) as { id: number; display_name: string; seq_type: string; project_ids: string[] };
    expect(meta.id).toBe(1);
    expect(meta.display_name).toBe("Plasmid pTest");
    expect(meta.seq_type).toBe("dna");
    // No project links travel (the sender's are meaningless in the destination).
    expect(meta.project_ids).toEqual([]);

    // The destination counter advanced to 1; the source folder got nothing.
    const destCounters = readRawJson(
      destRoot,
      `users/${DEST_USER}/_counters.json`,
    ) as { sequences?: number };
    expect(destCounters.sequences).toBe(1);
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/sequences/1.gb`)).toBeNull();
  });

  it("copies a CALCULATOR into the destination with a fresh id, owner-only on arrival", async () => {
    stubDestRegistry("dest-folder", "head");
    const calc = makeSourceCalculator();
    const target: TransferTarget = {
      kind: "calculator",
      calculator: calc,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await copyObjectToFolder(target, "dest-folder");

    expect(outcome.kind).toBe("calculator");
    expect(outcome.destId).toBe(1);
    const rec = readRawJson(
      destRoot,
      `users/${DEST_USER}/calculators/1.json`,
    ) as { id: number; name: string; shared_with: unknown[] };
    expect(rec.id).toBe(1);
    expect(rec.name).toBe("Molarity calc");
    // A copy is owner-only on arrival (sharing reset to "Just me").
    expect(rec.shared_with).toEqual([]);
  });

  it("REFUSES a method / experiment / project (no two-handle path yet)", async () => {
    stubDestRegistry("dest-folder", "head");
    const heavy: TransferTarget = {
      kind: "method",
      method: { id: 1, name: "Lyse cells" } as unknown as Extract<
        TransferTarget,
        { kind: "method" }
      >["method"],
      sourceUsername: SOURCE_USER,
    };
    await expect(copyObjectToFolder(heavy, "dest-folder")).rejects.toBeInstanceOf(
      CrossFolderCopyError,
    );
    // Nothing was written into the destination.
    expect(
      readRaw(destRoot, `users/${DEST_USER}/methods/1.json`),
    ).toBeNull();
  });
});

// ── Stage 2: MOVE (addendum M3, trashing delete + verified ordering) ──────────

describe("moveObjectToFolder", () => {
  it("moves a note: destination gets a fresh-id copy, source is trashed", async () => {
    stubDestRegistry("dest-folder", "head");
    const note = makeSourceNote();
    const target: TransferTarget = {
      kind: "note",
      note,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await moveObjectToFolder(target, "dest-folder");

    // The destination has the copy under a fresh id (41 -> 42).
    expect(outcome.destId).toBe(42);
    const destNote = readRawJson(
      destRoot,
      `users/${DEST_USER}/notes/42.json`,
    ) as Note;
    expect(destNote.title).toBe("Crystal prep");

    // The source delete was invoked AND verified gone (the mock removes it from
    // the live set, so the post-delete get returns null -> "moved" reported).
    expect(deletedNotes.has(note.id)).toBe(true);
  });

  it("leaves the source intact when the destination write FAILS (no-op)", async () => {
    // Point the registry at a destination handle that has no users/ dir, so
    // resolveDestinationUsername returns null and materialize never runs.
    const emptyRoot = new MockDirectory("empty");
    destHandle = emptyRoot;
    vi.spyOn(idb, "getActiveFolderId").mockResolvedValue("active-folder");
    vi.spyOn(idb, "listRememberedFolders").mockResolvedValue([
      {
        id: "dest-folder",
        name: "Empty destination",
        lastOpenedAt: 1,
        labRole: "head",
        handle: emptyRoot as unknown as FileSystemDirectoryHandle,
      },
    ]);
    vi.spyOn(idb, "getRememberedFolderHandle").mockResolvedValue(
      emptyRoot as unknown as FileSystemDirectoryHandle,
    );

    const note = makeSourceNote();
    const target: TransferTarget = {
      kind: "note",
      note,
      sourceUsername: SOURCE_USER,
    };

    await expect(moveObjectToFolder(target, "dest-folder")).rejects.toBeInstanceOf(
      CrossFolderCopyError,
    );
    // The source was NEVER deleted, because the destination write failed first.
    expect(deletedNotes.has(note.id)).toBe(false);
  });

  it("surfaces SourceNotRemovedError when the copy succeeds but the source delete cannot remove it", async () => {
    stubDestRegistry("dest-folder", "head");
    // Make the source delete a no-op (e.g. the cross-owner gate refused), so the
    // post-delete verify still SEES the record and reports copied-but-not-removed.
    const { notesApi } = (await import("@/lib/local-api")) as unknown as {
      notesApi: { delete: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
    };
    notesApi.delete.mockImplementationOnce(async () => {
      /* refused: leave the record in place */
    });
    notesApi.get.mockImplementationOnce(async (id: number) => ({ id }));

    const note = makeSourceNote();
    const target: TransferTarget = {
      kind: "note",
      note,
      sourceUsername: SOURCE_USER,
    };

    await expect(moveObjectToFolder(target, "dest-folder")).rejects.toBeInstanceOf(
      SourceNotRemovedError,
    );
    // The destination copy IS present (the copy is safe; only the source removal failed).
    expect(readRaw(destRoot, `users/${DEST_USER}/notes/42.json`)).not.toBeNull();
  });
});

// ── Stage 2: BULK / multi-select ──────────────────────────────────────────────

describe("bulkTransfer", () => {
  it("copies a mixed batch: a note + a sequence succeed, a no-builder kind is reported failed without aborting", async () => {
    stubDestRegistry("dest-folder", "head");

    const items: TransferTarget[] = [
      { kind: "note", note: makeSourceNote(), sourceUsername: SOURCE_USER },
      {
        kind: "sequence",
        sequence: makeSourceSequence(),
        sourceUsername: SOURCE_USER,
      },
      // A heavy kind with no two-handle path: must be reported failed, not abort.
      {
        kind: "project",
        project: { id: 2, name: "Grant aims" } as unknown as Extract<
          TransferTarget,
          { kind: "project" }
        >["project"],
        sourceUsername: SOURCE_USER,
      },
    ];

    const result = await bulkTransfer(items, "dest-folder", "copy");

    expect(result.okCount).toBe(2);
    expect(result.failCount).toBe(1);
    // Item order is preserved.
    expect(result.items[0].ok).toBe(true);
    expect(result.items[1].ok).toBe(true);
    expect(result.items[2].ok).toBe(false);
    if (!result.items[2].ok) {
      expect(result.items[2].reason).toMatch(/not supported yet/i);
    }

    // Both supported items actually landed in the destination.
    expect(readRaw(destRoot, `users/${DEST_USER}/notes/42.json`)).not.toBeNull();
    expect(readRaw(destRoot, `users/${DEST_USER}/sequences/1.gb`)).not.toBeNull();
  });

  it("bulk MOVE trashes the source of each successfully copied item", async () => {
    stubDestRegistry("dest-folder", "head");
    const note = makeSourceNote();
    const items: TransferTarget[] = [
      { kind: "note", note, sourceUsername: SOURCE_USER },
    ];

    const result = await bulkTransfer(items, "dest-folder", "move");

    expect(result.mode).toBe("move");
    expect(result.okCount).toBe(1);
    expect(deletedNotes.has(note.id)).toBe(true);
  });
});
