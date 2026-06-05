/**
 * Tests for restore.ts (Phase 2 chunk 5: restore a version as a forward commit).
 *
 * fileService is mocked in-memory so persistNote + loadOrRebuild run cleanly
 * in the vitest node environment without the File System Access API.
 *
 * Setup: a raw LoroDoc + a minimal NoteHandle-like object exposing .doc and
 * .commit/.flush (using a lightweight stand-in rather than the full openNote
 * path, which wires cache + external-edit detection; we only need the doc +
 * commit message for these tests).
 *
 * Multi-version doc:
 *   change 0: seed commit (peer "0", from seedNoteDoc)
 *   change 1: edit "v1 text" (peer device, committed)
 *   change 2: edit "v2 text" (peer device, committed)
 *
 * Test plan:
 *   1. restoreLoroVersion(handle, owner, base, v1Index, "mira") returns a note
 *      whose entry content is "v1 text", AND a new forward commit exists
 *      (getAllChanges count increased), AND the result carries a
 *      revert_undo_window with from_version = pre-restore HEAD and
 *      to_version = v1Index.
 *   2. After the restore, reconstructNoteAt at the NEW HEAD returns the v1
 *      content -- proves the restore wrote a forward commit, not a rewind.
 *   3. undoLoroRestore back to the original head (v2Index) returns "v2 text"
 *      and a null revert_undo_window.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { seedNoteDoc } from "../seed";
import { setEntryContent } from "../note-doc";
import type { Note, NoteComment } from "@/lib/types";
import type { NoteHandle } from "../store";

// ---------------------------------------------------------------------------
// In-memory fileService mock
// ---------------------------------------------------------------------------
//
// Mirrors the pattern used in history.test.ts: a mutable blobStore + fileStore
// so setSidecar can inject bytes that loadOrRebuild + persistNote read/write.

let blobStore = new Map<string, Blob>();
const fileStore = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(async (path: string) => blobStore.get(path) ?? null),
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      blobStore.set(path, blob);
    }),
    readJson: vi.fn(async (path: string) => fileStore.get(path) ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fileStore.set(path, data);
    }),
    ensureDir: vi.fn(async () => {}),
  },
}));

// Import AFTER the mock is hoisted.
import { restoreLoroVersion, undoLoroRestore } from "../restore";
import { listVersions, reconstructNoteAt } from "../history";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER = "mira";
const DEVICE_PEER = BigInt(555001);

function sidecarPath(owner: string, noteId: number): string {
  return `users/${owner}/.researchos/notes/${noteId}.loro`;
}

function mirrorPath(owner: string, noteId: number): string {
  return `users/${owner}/notes/${noteId}.json`;
}

/** Persist a LoroDoc's snapshot bytes into the blob store mock. */
function saveSidecar(owner: string, noteId: number, doc: LoroDoc): void {
  const bytes = doc.export({ mode: "snapshot" });
  blobStore.set(
    sidecarPath(owner, noteId),
    new Blob([bytes.buffer as ArrayBuffer]),
  );
}

function fixtureNote(overrides?: Partial<Note>): Note {
  return {
    id: 42,
    title: "Immunoprecipitation protocol",
    description: "IP conditions for antibody panel",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-05-10T08:00:00Z",
    updated_at: "2026-05-10T09:00:00Z",
    username: OWNER,
    comments: [] as NoteComment[],
    flagged: null,
    entries: [
      {
        id: "entry-a",
        title: "Day 1",
        date: "2026-05-10",
        content: "Initial elution buffer.",
        created_at: "2026-05-10T08:00:00Z",
        updated_at: "2026-05-10T08:00:00Z",
      },
    ],
    ...overrides,
  };
}

/**
 * Minimal handle-like object: exposes .doc + .commit and .flush.
 * We avoid the full openNote path (cache + external-edit detection) because
 * we are testing the restore logic itself, not the store facade.
 */
function makeHandle(doc: LoroDoc): NoteHandle {
  return {
    doc,
    bindEditorExtension: () => [],
    ensureEntries: () => {},
    commit: async () => {},
    flush: async () => {},
    subscribe: () => () => {},
    close: async () => {},
    // Auto-save additions (auto-save bot, 2026-06-05): always settled in tests.
    commitPending: false as boolean,
    subscribeCommitPending: (cb: (v: boolean) => void) => {
      cb(false);
      return () => {};
    },
  };
}

/**
 * Count how many total changes are recorded across all peers in the doc.
 * Used to verify that a restore added a NEW forward commit.
 */
function countAllChanges(doc: LoroDoc): number {
  const allChanges = doc.getAllChanges() as Map<string, unknown[]>;
  let total = 0;
  for (const changes of allChanges.values()) {
    total += changes.length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Shared setup: build a 3-version doc (seed + v1 + v2)
// ---------------------------------------------------------------------------

beforeEach(() => {
  blobStore = new Map();
  fileStore.clear();
  vi.clearAllMocks();
});

/** Build the multi-version doc, persist it, and return {doc, note, versions}. */
async function buildMultiVersionDoc() {
  const base = fixtureNote();

  // Seed the doc.
  const seedBytes = seedNoteDoc(base);
  const doc = new LoroDoc();
  doc.import(seedBytes);
  doc.setPeerId(DEVICE_PEER);

  // Change 1: v1 text.
  setEntryContent(doc, 0, "v1 text");
  doc.commit({ message: "edit-v1", timestamp: 1747000100 });

  // Change 2: v2 text.
  setEntryContent(doc, 0, "v2 text");
  doc.commit({ message: "edit-v2", timestamp: 1747000200 });

  // Persist the sidecar so loadOrRebuild returns this multi-version doc.
  saveSidecar(OWNER, base.id, doc);

  const versions = await listVersions(OWNER, base);
  // Expected: 3 versions (seed=0, v1=1, v2=2).
  expect(versions.length).toBe(3);

  return { doc, base, versions };
}

// ---------------------------------------------------------------------------
// Test 1: restoreLoroVersion returns v1 content + forward commit + undo window
// ---------------------------------------------------------------------------

describe("restoreLoroVersion", () => {
  it("returns the restored entry content, adds a forward commit, and stamps the undo window", async () => {
    const { doc, base, versions } = await buildMultiVersionDoc();
    const handle = makeHandle(doc);

    const preRestoreChanges = countAllChanges(doc);
    const v1Index = 1; // change 1 = "v1 text"
    const preRestoreHead = versions.length - 1; // 2

    const result = await restoreLoroVersion(handle, OWNER, base, v1Index, OWNER);

    // The returned note must carry the v1 entry content.
    expect(result.entries[0].content).toBe("v1 text");

    // A new FORWARD commit must have been added (not a rewind).
    const postRestoreChanges = countAllChanges(doc);
    expect(postRestoreChanges).toBeGreaterThan(preRestoreChanges);

    // The last commit message must be the restore stamp.
    const allChanges = doc.getAllChanges() as Map<string, Array<{ message?: string }>>;
    const flat: Array<{ message?: string }> = [];
    for (const changes of allChanges.values()) {
      for (const c of changes) flat.push(c);
    }
    const lastMsg = flat[flat.length - 1]?.message ?? "";
    expect(lastMsg).toBe(`restore-v${v1Index}`);

    // The undo window must be stamped with the correct indices.
    expect(result.revert_undo_window).not.toBeNull();
    expect(result.revert_undo_window).not.toBeUndefined();
    expect(result.revert_undo_window!.from_version).toBe(preRestoreHead);
    expect(result.revert_undo_window!.to_version).toBe(v1Index);
    expect(result.revert_undo_window!.reverted_by).toBe(OWNER);
    // expires_at must be ~24h after reverted_at.
    const diff =
      new Date(result.revert_undo_window!.expires_at).getTime() -
      new Date(result.revert_undo_window!.reverted_at).getTime();
    expect(diff).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it("persists the sidecar (writeFileFromBlob called with the restore commit)", async () => {
    const { doc, base } = await buildMultiVersionDoc();
    const { fileService } = await import("@/lib/file-system/file-service");
    const writeSpy = fileService.writeFileFromBlob as ReturnType<typeof vi.fn>;
    writeSpy.mockClear();

    const handle = makeHandle(doc);
    await restoreLoroVersion(handle, OWNER, base, 1, OWNER);

    // persistNote calls writeFileFromBlob for the sidecar and writeJson for
    // the mirror. Verify sidecar write happened.
    const sidecarCalls = writeSpy.mock.calls.filter((args: unknown[]) =>
      args[0] === sidecarPath(OWNER, base.id),
    );
    expect(sidecarCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: after restore, reconstructNoteAt at the NEW HEAD returns v1 content
// ---------------------------------------------------------------------------

describe("restoreLoroVersion: forward-commit proof", () => {
  it("the restore commit is readable as a new HEAD version", async () => {
    const { doc, base } = await buildMultiVersionDoc();
    const handle = makeHandle(doc);

    await restoreLoroVersion(handle, OWNER, base, 1, OWNER);

    // After the restore, the sidecar now contains the forward commit.
    // Re-list versions: the new HEAD must exist.
    const versionsAfter = await listVersions(OWNER, base);
    // We had 3 before; the restore added 1 more (the forward commit).
    expect(versionsAfter.length).toBeGreaterThan(3);

    // reconstructNoteAt at the new HEAD must return the v1 content.
    const newHead = versionsAfter.length - 1;
    const reconstructed = await reconstructNoteAt(OWNER, base, newHead);
    expect(reconstructed.entries[0].content).toBe("v1 text");
  });
});

// ---------------------------------------------------------------------------
// Test 3: undoLoroRestore round-trips back to v2 content and clears the window
// ---------------------------------------------------------------------------

describe("undoLoroRestore", () => {
  it("returns v2 content and a null revert_undo_window after undoing the v1 restore", async () => {
    const { doc, base, versions } = await buildMultiVersionDoc();
    const handle = makeHandle(doc);

    // First restore to v1.
    const afterRestore = await restoreLoroVersion(handle, OWNER, base, 1, OWNER);
    expect(afterRestore.revert_undo_window).not.toBeNull();

    // Undo: restore back to from_version (v2, index 2).
    const fromVersion = afterRestore.revert_undo_window!.from_version;
    expect(fromVersion).toBe(versions.length - 1); // 2

    const afterUndo = await undoLoroRestore(handle, OWNER, base, fromVersion, OWNER);

    // The entry content must be back to "v2 text".
    expect(afterUndo.entries[0].content).toBe("v2 text");

    // The undo window must be cleared (undefined = no active window).
    expect(afterUndo.revert_undo_window).toBeFalsy();
  });

  it("the undo commit is itself a forward commit (history keeps growing)", async () => {
    const { doc, base } = await buildMultiVersionDoc();
    const handle = makeHandle(doc);

    const afterRestore = await restoreLoroVersion(handle, OWNER, base, 1, OWNER);
    const changesAfterRestore = countAllChanges(doc);

    await undoLoroRestore(
      handle,
      OWNER,
      base,
      afterRestore.revert_undo_window!.from_version,
      OWNER,
    );

    const changesAfterUndo = countAllChanges(doc);
    // The undo added at least one more commit on top.
    expect(changesAfterUndo).toBeGreaterThan(changesAfterRestore);
  });
});
