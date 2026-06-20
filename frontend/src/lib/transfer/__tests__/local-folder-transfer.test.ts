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
const deletedMethods = new Set<number>();
const deletedTasks = new Set<number>();
const deletedProjects = new Set<number>();
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
  // methodsApi is consumed by the MOVE source-trash for the HEAVY method kind.
  // delete takes only the id (it resolves the owner namespace itself), and
  // get is owner-routed; both stubbed here so the cross-folder ORDERING test
  // focuses on copy-then-delete + verify-source-gone, not the real trash flow.
  methodsApi: {
    delete: vi.fn(async (id: number) => {
      deletedMethods.add(id);
    }),
    get: vi.fn(async (id: number) => (deletedMethods.has(id) ? null : { id })),
  },
  // tasksApi is consumed by the MOVE source-trash for the HEAVY experiment kind.
  // delete takes only the id; get is owner-routed. Same focus as methodsApi:
  // exercise the cross-folder ordering, not the real task-trash cascade.
  tasksApi: {
    delete: vi.fn(async (id: number) => {
      deletedTasks.add(id);
    }),
    get: vi.fn(async (id: number) => (deletedTasks.has(id) ? null : { id })),
  },
  // projectsApi is consumed by the MOVE source-trash for the HEAVY project kind.
  // delete takes only the id (cascades to tasks + results + deps); get is
  // owner-routed. Same focus as the other heavy deletes: exercise the ordering.
  projectsApi: {
    delete: vi.fn(async (id: number) => {
      deletedProjects.add(id);
    }),
    get: vi.fn(async (id: number) => (deletedProjects.has(id) ? null : { id })),
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
import type {
  SequenceDetail,
  CustomCalculator,
  Method,
  Task,
  Project,
} from "@/lib/types";

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

// A markdown method whose body file lives at the FOLDER root under
// methods/<slug>/<file>.md (not under users/<u>/). The source_path points there.
const METHOD_BODY_MD = "# Lyse cells\n\n1. Add buffer\n2. Vortex 30s\n";
function makeSourceMarkdownMethod(): Method {
  return {
    id: 7,
    name: "Lyse cells",
    source_path: "methods/lyse-cells/lyse-cells.md",
    source_pdf_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: ["prep"],
    is_public: false,
    created_by: null,
    owner: SOURCE_USER,
    shared_with: [],
    // Read-time overlays + provenance that MUST be stripped on copy.
    is_shared_with_me: true,
    shared_permission: "edit",
    received_from: "someone@example.com",
    source_uuid: "src-uuid-7",
  } as unknown as Method;
}

// A structured PCR method: its source_path references a per-user protocol record
// that must be re-created in the destination's id-space with the source_path
// rewritten to the new protocol id.
function makeSourcePcrMethod(): Method {
  return {
    id: 8,
    name: "Colony PCR",
    source_path: "pcr://protocol/3",
    source_pdf_path: null,
    method_type: "pcr",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: null,
    owner: SOURCE_USER,
    shared_with: [],
  } as unknown as Method;
}

// A source experiment (task) referencing the markdown method (id 7) both via
// method_ids and via a method_attachment, plus a results subtree.
const EXP_NOTES_MD = "## Lab notes\n\nRan the lysis at 4C.\n";
const EXP_RESULT_IMG = new Uint8Array([9, 8, 7, 6, 5]);
function makeSourceExperiment(): Task {
  return {
    id: 12,
    project_id: 4,
    name: "Lysis timecourse",
    start_date: "2026-06-01",
    duration_days: 3,
    end_date: "2026-06-03",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [7],
    deviation_log: null,
    tags: ["timecourse"],
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [
      {
        method_id: 7,
        owner: SOURCE_USER,
        pcr_gradient: null,
        pcr_ingredients: null,
        lc_gradient: null,
        body_override: null,
        plate_annotation: null,
        cell_culture_schedule: null,
        variation_notes: "doubled the buffer",
        compound_snapshots: null,
        qpcr_analysis: null,
      },
    ],
    owner: SOURCE_USER,
    shared_with: [],
    // Overlays + provenance + collab ids that MUST be stripped on copy.
    is_shared_with_me: true,
    shared_permission: "edit",
    received_from: "lab@example.com",
    collab_doc_id: "doc-abc",
  } as unknown as Task;
}

// A source PROJECT (id 4) the experiment (task 12) belongs to, plus a second
// task (id 13) so a dependency between them can be rebuilt in the destination.
function makeSourceProject(): Project {
  return {
    id: 4,
    name: "Lysis grant aims",
    weekend_active: false,
    tags: ["aim1"],
    color: "#abc",
    created_at: "2026-05-01T00:00:00.000Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: SOURCE_USER,
    shared_with: [],
    // Fields that MUST be stripped on copy.
    is_shared_with_me: true,
    funding_account_id: 9,
    imported_from: { sender: "x", imported_at: "", source_project_name: "", source_grant: null },
  } as unknown as Project;
}

function makeSecondProjectTask(): Task {
  return {
    id: 13,
    project_id: 4,
    name: "Western blot",
    start_date: "2026-06-04",
    duration_days: 1,
    end_date: "2026-06-04",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 1,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: SOURCE_USER,
    shared_with: [],
  } as unknown as Task;
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
  deletedMethods.clear();
  deletedTasks.clear();
  deletedProjects.clear();
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

  // Seed the HEAVY method fixtures on the SOURCE disk so the cross-folder method
  // twin (heavy-transfer.ts) reads them straight off disk, no local-api.
  //   - the markdown method's record + its body file at the FOLDER root.
  //   - the PCR method's record + its per-user protocol record.
  await seedJson(
    sourceRoot,
    `users/${SOURCE_USER}/methods/7.json`,
    makeSourceMarkdownMethod(),
  );
  await writeRaw(
    sourceRoot,
    "methods/lyse-cells/lyse-cells.md",
    new TextEncoder().encode(METHOD_BODY_MD),
  );
  await seedJson(
    sourceRoot,
    `users/${SOURCE_USER}/methods/8.json`,
    makeSourcePcrMethod(),
  );
  await seedJson(sourceRoot, `users/${SOURCE_USER}/pcr_protocols/3.json`, {
    id: 3,
    name: "Colony PCR mix",
    gradient: { initial: [], cycles: [], final: [], hold: null },
    ingredients: [{ id: "1", name: "Taq", concentration: "5U", amount_per_reaction: "0.2", checked: false }],
    notes: null,
    is_public: false,
    created_by: null,
  });

  // Seed the source EXPERIMENT (task 12) + its results subtree (notes.md + a
  // per-tab Results-tab image attachment) so the experiment twin copies them.
  await seedJson(
    sourceRoot,
    `users/${SOURCE_USER}/tasks/12.json`,
    makeSourceExperiment(),
  );
  await writeRaw(
    sourceRoot,
    `users/${SOURCE_USER}/results/task-12/notes.md`,
    new TextEncoder().encode(EXP_NOTES_MD),
  );
  await seedBytes(
    sourceRoot,
    `users/${SOURCE_USER}/results/task-12/results/Images/gel.png`,
    EXP_RESULT_IMG,
  );

  // Seed the source PROJECT (id 4) + a second task (id 13) in it + a dependency
  // linking 12 -> 13 + a sequence filed into project 4, so the project twin can
  // carry the whole closure (tasks, intra-project dep, sequence).
  await seedJson(
    sourceRoot,
    `users/${SOURCE_USER}/projects/4.json`,
    makeSourceProject(),
  );
  await seedJson(
    sourceRoot,
    `users/${SOURCE_USER}/tasks/13.json`,
    makeSecondProjectTask(),
  );
  await seedJson(sourceRoot, `users/${SOURCE_USER}/dependencies/1.json`, {
    id: 1,
    parent_id: 12,
    child_id: 13,
    dep_type: "FS",
  });
  await writeRaw(
    sourceRoot,
    `users/${SOURCE_USER}/sequences/2.gb`,
    new TextEncoder().encode(GENBANK_TEXT),
  );
  await seedJson(sourceRoot, `users/${SOURCE_USER}/sequences/2.meta.json`, {
    id: 2,
    display_name: "Project plasmid",
    project_ids: ["4"],
    added_at: "2026-06-01T00:00:00.000Z",
    seq_type: "dna",
  });

  // Seed the DESTINATION folder: a Main user pin + a pre-existing notes counter
  // at 41, so a fresh id must be 42 (proving it comes from the DEST counter). The
  // sequence + calculator counters start unset so a first copy lands id 1.
  await seedJson(destRoot, "users/_user_metadata.json", { main_user: DEST_USER });
  await seedJson(destRoot, `users/${DEST_USER}/_counters.json`, {
    notes: 41,
    tasks: 70,
    projects: 50,
    dependencies: 30,
    // sequences left unset so a project sequence copy lands id 1.
  });
  // Methods + structured protocols draw from the GLOBAL counter even when
  // private. Seed it at 100 (methods) / 200 (pcr) so a fresh copy proves its id
  // came from the DESTINATION global counter, not the source method id.
  await seedJson(destRoot, "users/_global_counters.json", {
    methods: 100,
    pcr_protocols: 200,
  });
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

  it("DEFENSIVELY refuses an unknown kind (no transfer path at all)", async () => {
    stubDestRegistry("dest-folder", "head");
    // Every known kind (note/sequence/calculator/method/experiment/project) is
    // now wired. An unknown kind must still be refused before any write, via the
    // unsupportedReason defensive fallback.
    const unknown = {
      kind: "totally-unknown",
      sourceUsername: SOURCE_USER,
    } as unknown as TransferTarget;
    await expect(copyObjectToFolder(unknown, "dest-folder")).rejects.toBeInstanceOf(
      CrossFolderCopyError,
    );
  });
});

// ── Stage 1 (heavy): METHOD cross-folder copy / move ──────────────────────────

describe("copyObjectToFolder, METHOD (heavy type)", () => {
  it("copies a MARKDOWN method: fresh global id, body file carried, owner-only, source untouched", async () => {
    stubDestRegistry("dest-folder", "head");
    const method = makeSourceMarkdownMethod();
    const target: TransferTarget = {
      kind: "method",
      method,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await copyObjectToFolder(target, "dest-folder");

    // Fresh id from the DESTINATION GLOBAL counter (100 -> 101), not the source (7).
    expect(outcome.kind).toBe("method");
    expect(outcome.destId).toBe(101);
    const destGlobal = readRawJson(destRoot, "users/_global_counters.json") as {
      methods: number;
    };
    expect(destGlobal.methods).toBe(101);

    const rec = readRawJson(
      destRoot,
      `users/${DEST_USER}/methods/101.json`,
    ) as Method;
    expect(rec.id).toBe(101);
    expect(rec.name).toBe("Lyse cells");
    // Owner-only on arrival, sharing + provenance + portable identity stripped.
    expect(rec.owner).toBe(DEST_USER);
    expect(rec.is_public).toBe(false);
    expect(rec.shared_with).toEqual([]);
    expect(rec.is_shared_with_me).toBeUndefined();
    expect(rec.shared_permission).toBeUndefined();
    expect(rec.received_from).toBeUndefined();
    expect((rec as { source_uuid?: string }).source_uuid).toBeUndefined();
    // The body file landed at the destination root under the method slug, with
    // source_path rewritten to point at the new location.
    expect(rec.source_path).toBe("methods/lyse-cells/lyse-cells.md");
    const body = readRaw(destRoot, "methods/lyse-cells/lyse-cells.md");
    expect(body).not.toBeNull();
    expect(new TextDecoder().decode(body!)).toBe(METHOD_BODY_MD);

    // SOURCE untouched: the source record + body still present, no id-101 leak.
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/methods/7.json`)).not.toBeNull();
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/methods/101.json`)).toBeNull();
  });

  it("copies a PCR method: protocol re-created in the destination id-space, source_path rewritten", async () => {
    stubDestRegistry("dest-folder", "head");
    const method = makeSourcePcrMethod();
    const target: TransferTarget = {
      kind: "method",
      method,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await copyObjectToFolder(target, "dest-folder");

    expect(outcome.destId).toBe(101);
    const rec = readRawJson(
      destRoot,
      `users/${DEST_USER}/methods/101.json`,
    ) as Method;
    // The protocol got a fresh DESTINATION global id (pcr_protocols 200 -> 201)
    // and the method's source_path points at it, not the source's protocol 3.
    expect(rec.source_path).toBe("pcr://protocol/201");
    const proto = readRawJson(
      destRoot,
      `users/${DEST_USER}/pcr_protocols/201.json`,
    ) as { id: number; name: string; is_public: boolean };
    expect(proto.id).toBe(201);
    expect(proto.name).toBe("Colony PCR mix");
    expect(proto.is_public).toBe(false);

    // The source protocol record is unchanged.
    const srcProto = readRawJson(
      sourceRoot,
      `users/${SOURCE_USER}/pcr_protocols/3.json`,
    ) as { id: number };
    expect(srcProto.id).toBe(3);
  });
});

describe("moveObjectToFolder, METHOD (heavy type)", () => {
  it("moves a method: destination gets a fresh-id copy, source is trashed via methodsApi.delete", async () => {
    stubDestRegistry("dest-folder", "head");
    const method = makeSourceMarkdownMethod();
    const target: TransferTarget = {
      kind: "method",
      method,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await moveObjectToFolder(target, "dest-folder");

    expect(outcome.destId).toBe(101);
    expect(readRaw(destRoot, `users/${DEST_USER}/methods/101.json`)).not.toBeNull();
    // The source delete was invoked AND verified gone (the mock removes it from
    // the live set, so the post-delete get returns null -> "moved" reported).
    expect(deletedMethods.has(method.id)).toBe(true);
  });
});

// ── Stage 2 (heavy): EXPERIMENT cross-folder copy / move ──────────────────────

describe("copyObjectToFolder, EXPERIMENT (heavy type)", () => {
  it("copies a task: fresh id, methods localized + links remapped, results subtree carried, source untouched", async () => {
    stubDestRegistry("dest-folder", "head");
    const task = makeSourceExperiment();
    const target: TransferTarget = {
      kind: "experiment",
      task,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await copyObjectToFolder(target, "dest-folder");

    // Fresh task id from the DESTINATION per-user counter (70 -> 71), not 12.
    expect(outcome.kind).toBe("experiment");
    expect(outcome.destId).toBe(71);

    const rec = readRawJson(
      destRoot,
      `users/${DEST_USER}/tasks/71.json`,
    ) as Task;
    expect(rec.id).toBe(71);
    expect(rec.name).toBe("Lysis timecourse");
    // Owner-only, project reset to Unfiled, overlays/provenance/collab stripped.
    expect(rec.owner).toBe(DEST_USER);
    expect(rec.project_id).toBe(0);
    expect(rec.shared_with).toEqual([]);
    expect(rec.is_shared_with_me).toBeUndefined();
    expect(rec.received_from).toBeUndefined();
    expect((rec as { collab_doc_id?: string }).collab_doc_id).toBeUndefined();

    // The referenced method (id 7) was localized into the destination (fresh
    // global id 101) and BOTH reference surfaces point at the new id.
    expect(rec.method_ids).toEqual([101]);
    expect(rec.method_attachments).toHaveLength(1);
    expect(rec.method_attachments[0].method_id).toBe(101);
    // The attachment owner is reset to null (same namespace as the new task).
    expect(rec.method_attachments[0].owner).toBeNull();
    expect(rec.method_attachments[0].variation_notes).toBe("doubled the buffer");
    // The localized method record exists in the destination.
    expect(readRaw(destRoot, `users/${DEST_USER}/methods/101.json`)).not.toBeNull();

    // The results subtree was carried (notes.md + the per-tab results image).
    const notes = readRaw(destRoot, `users/${DEST_USER}/results/task-71/notes.md`);
    expect(notes).not.toBeNull();
    expect(new TextDecoder().decode(notes!)).toBe(EXP_NOTES_MD);
    const img = readRaw(
      destRoot,
      `users/${DEST_USER}/results/task-71/results/Images/gel.png`,
    );
    expect(img).not.toBeNull();
    expect(Array.from(img!)).toEqual(Array.from(EXP_RESULT_IMG));

    // SOURCE untouched: the source task + results still present, no id-71 leak.
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/tasks/12.json`)).not.toBeNull();
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/tasks/71.json`)).toBeNull();
  });
});

describe("moveObjectToFolder, EXPERIMENT (heavy type)", () => {
  it("moves an experiment: destination gets a fresh-id copy, source is trashed via tasksApi.delete", async () => {
    stubDestRegistry("dest-folder", "head");
    const task = makeSourceExperiment();
    const target: TransferTarget = {
      kind: "experiment",
      task,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await moveObjectToFolder(target, "dest-folder");

    expect(outcome.destId).toBe(71);
    expect(readRaw(destRoot, `users/${DEST_USER}/tasks/71.json`)).not.toBeNull();
    expect(deletedTasks.has(task.id)).toBe(true);
  });
});

// ── Stage 3 (heavy): PROJECT cross-folder copy / move ─────────────────────────

describe("copyObjectToFolder, PROJECT (heavy type)", () => {
  it("copies a project: fresh id, its tasks + deduped methods + intra-project dep + filed sequence all carried", async () => {
    stubDestRegistry("dest-folder", "head");
    const project = makeSourceProject();
    const target: TransferTarget = {
      kind: "project",
      project,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await copyObjectToFolder(target, "dest-folder");

    // Fresh project id from the DESTINATION per-user counter (50 -> 51).
    expect(outcome.kind).toBe("project");
    expect(outcome.destId).toBe(51);

    const rec = readRawJson(
      destRoot,
      `users/${DEST_USER}/projects/51.json`,
    ) as Project;
    expect(rec.id).toBe(51);
    expect(rec.name).toBe("Lysis grant aims");
    // Owner-only; overlays / grant link / provenance stripped.
    expect(rec.owner).toBe(DEST_USER);
    expect(rec.shared_with).toEqual([]);
    expect(rec.is_shared_with_me).toBeUndefined();
    expect((rec as { funding_account_id?: number }).funding_account_id).toBeUndefined();
    expect(rec.imported_from).toBeUndefined();

    // Both project tasks landed (12 -> 71, 13 -> 72), bound to the new project.
    const t1 = readRawJson(destRoot, `users/${DEST_USER}/tasks/71.json`) as Task;
    const t2 = readRawJson(destRoot, `users/${DEST_USER}/tasks/72.json`) as Task;
    expect(t1.project_id).toBe(51);
    expect(t2.project_id).toBe(51);
    // The method (id 7) referenced only by task 12 was localized once (id 101).
    expect(t1.method_ids).toEqual([101]);

    // The intra-project dependency (12 -> 13) was rebuilt against the new task
    // ids (71 -> 72) with a fresh dest dependency id (30 -> 31).
    const dep = readRawJson(
      destRoot,
      `users/${DEST_USER}/dependencies/31.json`,
    ) as { id: number; parent_id: number; child_id: number; dep_type: string };
    expect(dep.parent_id).toBe(71);
    expect(dep.child_id).toBe(72);
    expect(dep.dep_type).toBe("FS");

    // The project-filed sequence was carried + re-filed into the NEW project,
    // with a fresh dest sequence id (unset -> 1).
    const seqMeta = readRawJson(
      destRoot,
      `users/${DEST_USER}/sequences/1.meta.json`,
    ) as { id: number; display_name: string; project_ids: string[] };
    expect(seqMeta.id).toBe(1);
    expect(seqMeta.display_name).toBe("Project plasmid");
    expect(seqMeta.project_ids).toEqual(["51"]);
    const seqGb = readRaw(destRoot, `users/${DEST_USER}/sequences/1.gb`);
    expect(seqGb).not.toBeNull();

    // SOURCE untouched: the source project + tasks still present.
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/projects/4.json`)).not.toBeNull();
    expect(readRaw(sourceRoot, `users/${SOURCE_USER}/tasks/12.json`)).not.toBeNull();
  });
});

describe("moveObjectToFolder, PROJECT (heavy type)", () => {
  it("moves a project: destination gets a fresh-id copy, source is trashed via projectsApi.delete", async () => {
    stubDestRegistry("dest-folder", "head");
    const project = makeSourceProject();
    const target: TransferTarget = {
      kind: "project",
      project,
      sourceUsername: SOURCE_USER,
    };

    const outcome = await moveObjectToFolder(target, "dest-folder");

    expect(outcome.destId).toBe(51);
    expect(readRaw(destRoot, `users/${DEST_USER}/projects/51.json`)).not.toBeNull();
    expect(deletedProjects.has(project.id)).toBe(true);
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
  it("copies a mixed batch: a note + a sequence + a method succeed, an unknown kind is reported failed without aborting", async () => {
    stubDestRegistry("dest-folder", "head");

    const items: TransferTarget[] = [
      { kind: "note", note: makeSourceNote(), sourceUsername: SOURCE_USER },
      {
        kind: "sequence",
        sequence: makeSourceSequence(),
        sourceUsername: SOURCE_USER,
      },
      // A HEAVY method now succeeds in a heterogeneous batch.
      {
        kind: "method",
        method: makeSourceMarkdownMethod(),
        sourceUsername: SOURCE_USER,
      },
      // An UNKNOWN kind has no transfer path: it must be reported failed, not
      // abort the batch (the per-item refusal is reported, not thrown).
      {
        kind: "totally-unknown",
        sourceUsername: SOURCE_USER,
      } as unknown as TransferTarget,
    ];

    const result = await bulkTransfer(items, "dest-folder", "copy");

    expect(result.okCount).toBe(3);
    expect(result.failCount).toBe(1);
    // Item order is preserved.
    expect(result.items[0].ok).toBe(true);
    expect(result.items[1].ok).toBe(true);
    expect(result.items[2].ok).toBe(true);
    expect(result.items[3].ok).toBe(false);

    // The three supported items actually landed in the destination.
    expect(readRaw(destRoot, `users/${DEST_USER}/notes/42.json`)).not.toBeNull();
    expect(readRaw(destRoot, `users/${DEST_USER}/sequences/1.gb`)).not.toBeNull();
    expect(readRaw(destRoot, `users/${DEST_USER}/methods/101.json`)).not.toBeNull();
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
