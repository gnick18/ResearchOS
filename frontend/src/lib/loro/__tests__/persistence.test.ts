/**
 * Persistence backend tests for chunk 2 (mirror.ts + sidecar-store.ts).
 *
 * fileService requires the File System Access API (browser-only). All tests
 * that exercise the pure projection logic run with no disk I/O. Tests for
 * thin I/O wrappers mock fileService so they run cleanly in the vitest node
 * environment.
 *
 * NOT covered here: flag-off inertness (LORO_PILOT_ENABLED = false means
 * NoteDetailPopup writes no .researchos/ files). That test belongs in chunk
 * 5, which owns the NoteDetailPopup call site.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { seedNoteDoc, rebuildFromNote } from "../seed";
import { projectToNote } from "../mirror";
import { syncNoteMetadataToDoc, syncEntrySet, listEntries, getEntryContentText } from "../note-doc";
import { loadOrRebuild, persistNote, sidecarPath } from "../sidecar-store";
import type { Note, NoteComment } from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function fixtureNote(): Note {
  return {
    id: 99,
    title: "Western blot QC",
    description: "Antibody validation runs",
    is_running_log: false,
    is_shared: true,
    created_at: "2026-05-01T10:00:00Z",
    updated_at: "2026-05-01T12:00:00Z",
    username: "mira",
    comments: [
      {
        id: "c1",
        author: "mira",
        text: "Looks good.",
        created_at: "2026-05-01T11:00:00Z",
      } as NoteComment,
    ],
    flagged: null,
    entries: [
      {
        id: "entry-b",
        title: "Run 2",
        date: "2026-05-02",
        content: "Second replicate.\nBand at 55 kDa confirmed.",
        created_at: "2026-05-02T09:00:00Z",
        updated_at: "2026-05-02T10:00:00Z",
      },
      {
        id: "entry-a",
        title: "Run 1",
        date: "2026-05-01",
        content: "# Protocol\n\nLoaded 20 ug total protein.",
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-01T12:00:00Z",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test 1: projection round-trip (pure, no disk)
// ---------------------------------------------------------------------------

describe("projectToNote: CRDT-tracked fields overlaid, untracked fields preserved", () => {
  it("round-trips all tracked fields and preserves all untracked fields", () => {
    const note = fixtureNote();

    // Seed into a doc and import to simulate migrate-on-open.
    const bytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(bytes);

    const result = projectToNote(doc, note);

    // CRDT-tracked meta fields.
    expect(result.title).toBe(note.title);
    expect(result.description).toBe(note.description);
    expect(result.is_running_log).toBe(note.is_running_log);
    expect(result.created_at).toBe(note.created_at);

    // CRDT-tracked entries in canonical id-sorted order (entry-a, entry-b).
    const sortedEntries = [...note.entries].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    expect(result.entries).toHaveLength(sortedEntries.length);
    for (let i = 0; i < sortedEntries.length; i++) {
      const expected = sortedEntries[i];
      const got = result.entries[i];
      expect(got.id).toBe(expected.id);
      expect(got.title).toBe(expected.title);
      expect(got.date).toBe(expected.date);
      expect(got.created_at).toBe(expected.created_at);
      expect(got.updated_at).toBe(expected.updated_at);
      expect(got.content).toBe(expected.content);
    }

    // Untracked fields must be preserved byte-for-byte from base.
    expect(result.id).toBe(note.id);
    expect(result.is_shared).toBe(note.is_shared);
    expect(result.comments).toBe(note.comments); // same reference (spread)
    expect(result.flagged).toBe(note.flagged);
    expect(result.username).toBe(note.username);
    expect(result.updated_at).toBe(note.updated_at);
  });
});

// ---------------------------------------------------------------------------
// Test 2: rebuild-from-mirror is deterministic (pure, no disk)
// ---------------------------------------------------------------------------

describe("rebuildFromNote determinism through the rebuild entry point", () => {
  it("two independent rebuilds produce byte-identical docs", () => {
    const note = fixtureNote();

    const bytesA = rebuildFromNote(note);
    const bytesB = rebuildFromNote(note);

    expect(bytesA.length).toBe(bytesB.length);
    for (let i = 0; i < bytesA.length; i++) {
      expect(bytesA[i]).toBe(bytesB[i]);
    }
  });

  it("a rebuilt doc round-trips through projectToNote", () => {
    const note = fixtureNote();
    const bytes = rebuildFromNote(note);
    const doc = new LoroDoc();
    doc.import(bytes);

    const result = projectToNote(doc, note);

    expect(result.title).toBe(note.title);
    expect(result.description).toBe(note.description);
    expect(result.entries).toHaveLength(note.entries.length);
  });
});

// ---------------------------------------------------------------------------
// fileService mock setup (shared by tests 3-5)
// ---------------------------------------------------------------------------

vi.mock("@/lib/file-system/file-service", () => {
  const fileService = {
    ensureDir: vi.fn().mockResolvedValue(null),
    writeFileFromBlob: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readFileAsBlob: vi.fn().mockResolvedValue(null),
  };
  return { fileService };
});

// Helper to grab the mocked fileService inside tests.
async function getMocks() {
  const mod = await import("@/lib/file-system/file-service");
  return mod.fileService as unknown as {
    ensureDir: ReturnType<typeof vi.fn>;
    writeFileFromBlob: ReturnType<typeof vi.fn>;
    writeJson: ReturnType<typeof vi.fn>;
    readFileAsBlob: ReturnType<typeof vi.fn>;
  };
}

beforeEach(async () => {
  const mocks = await getMocks();
  vi.clearAllMocks();
  // Default: sidecar missing (readFileAsBlob returns null).
  mocks.readFileAsBlob.mockResolvedValue(null);
  mocks.ensureDir.mockResolvedValue(null);
  mocks.writeFileFromBlob.mockResolvedValue(undefined);
  mocks.writeJson.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Test 3: loadOrRebuild falls back on a missing sidecar
// ---------------------------------------------------------------------------

describe("loadOrRebuild: missing sidecar triggers rebuild", () => {
  it("returns a usable doc whose projectToNote matches the base tracked fields", async () => {
    const note = fixtureNote();
    // readFileAsBlob returns null (default mock) -> sidecar is missing.

    const doc = await loadOrRebuild("mira", note);
    expect(doc).toBeInstanceOf(LoroDoc);

    const result = projectToNote(doc, note);
    expect(result.title).toBe(note.title);
    expect(result.description).toBe(note.description);
    expect(result.is_running_log).toBe(note.is_running_log);
    expect(result.entries).toHaveLength(note.entries.length);
  });
});

// ---------------------------------------------------------------------------
// Test 4: loadOrRebuild falls back on a CORRUPT sidecar
// ---------------------------------------------------------------------------

describe("loadOrRebuild: corrupt sidecar is swallowed, rebuild proceeds", () => {
  it("does not throw when doc.import receives garbage bytes", async () => {
    const mocks = await getMocks();
    const garbage = new Blob([new Uint8Array([1, 2, 3, 4])]);
    mocks.readFileAsBlob.mockResolvedValue(garbage);

    const note = fixtureNote();

    // Must not throw; graceful degradation is the contract.
    const doc = await expect(loadOrRebuild("mira", note)).resolves.toBeInstanceOf(LoroDoc);
    void doc; // suppress lint

    // The returned doc must be usable (rebuilt from mirror).
    const recovered = await loadOrRebuild("mira", note);
    const result = projectToNote(recovered, note);
    expect(result.title).toBe(note.title);
  });
});

// ---------------------------------------------------------------------------
// Test 5: persistNote writes sidecar before mirror
// ---------------------------------------------------------------------------

describe("persistNote: write ordering and correct paths", () => {
  it("calls writeFileFromBlob before writeJson with the correct paths", async () => {
    const mocks = await getMocks();

    const note = fixtureNote();
    const bytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(bytes);

    const callOrder: string[] = [];
    mocks.writeFileFromBlob.mockImplementation(async () => {
      callOrder.push("sidecar");
    });
    mocks.writeJson.mockImplementation(async () => {
      callOrder.push("mirror");
    });

    await persistNote("mira", doc, note);

    // Both writes happened.
    expect(mocks.writeFileFromBlob).toHaveBeenCalledTimes(1);
    expect(mocks.writeJson).toHaveBeenCalledTimes(1);

    // Sidecar path is correct.
    const sidecarArg = mocks.writeFileFromBlob.mock.calls[0][0] as string;
    expect(sidecarArg).toBe(sidecarPath("mira", note.id));

    // Mirror path is correct.
    const mirrorArg = mocks.writeJson.mock.calls[0][0] as string;
    expect(mirrorArg).toBe(`users/mira/notes/${note.id}.json`);

    // Sidecar is written BEFORE mirror (the crash-safety ordering guarantee).
    expect(callOrder).toEqual(["sidecar", "mirror"]);
  });
});

// ---------------------------------------------------------------------------
// Test: legacy metadata edits (rename) are not clobbered by the stale seed
// ---------------------------------------------------------------------------

describe("syncNoteMetadataToDoc: legacy title/metadata edits survive a content commit", () => {
  it("a note rename is reflected in the projection after the sync (not reverted to the seeded title)", () => {
    const note = fixtureNote();
    const doc = new LoroDoc();
    doc.import(seedNoteDoc(note));

    // Simulate a legacy rename: the title field is edited through the popup
    // header, not the Loro editor, so only the live `base` changes.
    const renamed: Note = { ...note, title: "Renamed via legacy field" };

    // Without the sync, projectToNote overlays the STALE seeded meta title and
    // reverts the rename (this is the bug the sync fixes).
    expect(projectToNote(doc, renamed).title).toBe(note.title);

    // After syncing the live metadata into the doc, the projection keeps the
    // rename. Content (Loro-owned) is untouched by the sync.
    const changed = syncNoteMetadataToDoc(doc, renamed);
    expect(changed).toBe(true);
    expect(projectToNote(doc, renamed).title).toBe("Renamed via legacy field");

    // Entry content still comes from the CRDT, unchanged by the metadata sync.
    const entries = listEntries(doc);
    const original = [...note.entries].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(entries.map((e) => e.content)).toEqual(original.map((e) => e.content));
  });

  it("returns false when nothing changed (no redundant commit)", () => {
    const note = fixtureNote();
    const doc = new LoroDoc();
    doc.import(seedNoteDoc(note));
    // Syncing the same values the doc was seeded with is a no-op.
    expect(syncNoteMetadataToDoc(doc, note)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: entry add/delete reconciles into the doc (running-log entry switch)
// ---------------------------------------------------------------------------

describe("syncEntrySet: a new entry is added to the doc so binding it does not crash", () => {
  it("appends a newly-added entry and removes a deleted one, matched by id", () => {
    const note = fixtureNote();
    const doc = new LoroDoc();
    doc.import(seedNoteDoc(note));
    const seededCount = note.entries.length;

    // A new entry was added through the legacy UI; the doc does not have it yet,
    // so binding to its index would return undefined (the crash). Reconcile.
    const withNew: Note = {
      ...note,
      entries: [
        ...note.entries,
        {
          id: "entry-new",
          title: "Entry 2",
          date: "2026-06-05",
          content: "fresh entry body",
          created_at: "2026-06-05T00:00:00Z",
          updated_at: "2026-06-05T00:00:00Z",
        },
      ],
    };
    expect(syncEntrySet(doc, withNew)).toBe(true);

    // The new entry now exists in the doc at the appended index, with content.
    const newIndex = seededCount; // appended after the existing entries
    const text = getEntryContentText(doc, newIndex);
    expect(text).toBeDefined();
    expect(text!.toString()).toBe("fresh entry body");
    expect(listEntries(doc).length).toBe(seededCount + 1);

    // Deleting that entry from the note reconciles it back out of the doc.
    expect(syncEntrySet(doc, note)).toBe(true);
    expect(listEntries(doc).length).toBe(seededCount);
    // Re-running with the same set is a no-op.
    expect(syncEntrySet(doc, note)).toBe(false);
  });
});
