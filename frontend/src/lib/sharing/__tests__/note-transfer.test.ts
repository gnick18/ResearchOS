// Tests for the NOTE transfer adapter (collect to bundle, import from bundle).
//
// Disk + api are mocked. The round-trip test additionally exercises the REAL
// buildBundle / readBundle (they are pure, no disk / network), proving the
// sanitized entity and attachment bytes survive a full serialize / verify.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildNoteBundleInput,
  importNoteBundle,
  InvalidBundleError,
} from "@/lib/sharing/note-transfer";
import { buildBundle, readBundle } from "@/lib/sharing/bundle";
import type { ReadBundleResult } from "@/lib/sharing/bundle";
import type { Note } from "@/lib/types";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/attachments/image-folder", () => ({
  listImagesInFolder: vi.fn(),
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(),
    writeFileFromBlob: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
  },
}));

vi.mock("@/lib/local-api", () => ({
  notesApi: {
    create: vi.fn(),
  },
}));

import { listImagesInFolder } from "@/lib/attachments/image-folder";
import { fileService } from "@/lib/file-system/file-service";
import { notesApi } from "@/lib/local-api";

const mockListImages = vi.mocked(listImagesInFolder);
const mockReadFileAsBlob = vi.mocked(fileService.readFileAsBlob);
const mockWriteFileFromBlob = vi.mocked(fileService.writeFileFromBlob);
const mockReadJson = vi.mocked(fileService.readJson);
const mockWriteJson = vi.mocked(fileService.writeJson);
const mockCreate = vi.mocked(notesApi.create);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 42,
    title: "Crystallization screen",
    description: "Day 1 setup",
    is_running_log: true,
    is_shared: true, // lab-local, must be DROPPED from the bundle entity
    entries: [
      {
        id: "entry-1",
        title: "Setup",
        date: "2026-06-01",
        content: "Plate A\n\n![gel](Images/gel-1.png)\n",
        created_at: "2026-06-01T10:00:00.000Z",
        updated_at: "2026-06-01T10:30:00.000Z",
      },
    ],
    comments: [{ id: "c1", author: "Grant", text: "nice", created_at: "x" }],
    flagged: null,
    created_at: "2026-06-01T09:00:00.000Z",
    updated_at: "2026-06-02T12:00:00.000Z",
    username: "Grant",
    shared_with: [{ username: "Mira", level: "edit" }],
    last_edited_by: "Grant",
    last_edited_at: "2026-06-02T12:00:00.000Z",
    notebook_id: "nb-99",
    received_from: "old@sender.edu", // must be DROPPED on re-share
    ...overrides,
  };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── buildNoteBundleInput (collect) ───────────────────────────────────────────

describe("buildNoteBundleInput", () => {
  it("produces an entityType 'note' input keyed to updated_at, version 1, fresh uuid", async () => {
    mockListImages.mockResolvedValue([]);
    const note = makeNote();

    const input = await buildNoteBundleInput(note, "Grant");

    expect(input.entityType).toBe("note");
    expect(input.version).toBe(1);
    expect(input.modifiedAt).toBe("2026-06-02T12:00:00.000Z");
    expect(typeof input.shareUuid).toBe("string");
    expect(input.shareUuid.length).toBeGreaterThan(0);
  });

  it("keeps content fields and drops account / lab-local fields", async () => {
    mockListImages.mockResolvedValue([]);
    const note = makeNote();

    const input = await buildNoteBundleInput(note, "Grant");
    const entity = input.entity as Record<string, unknown>;

    // KEPT
    expect(entity.title).toBe("Crystallization screen");
    expect(entity.description).toBe("Day 1 setup");
    expect(entity.is_running_log).toBe(true);
    expect(entity.notebook_id).toBe("nb-99");
    expect(Array.isArray(entity.entries)).toBe(true);
    const entries = entity.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Setup");
    expect(entries[0].date).toBe("2026-06-01");
    expect(entries[0].content).toContain("![gel](Images/gel-1.png)");

    // DROPPED
    for (const dropped of [
      "id",
      "username",
      "shared_with",
      "comments",
      "flagged",
      "last_edited_by",
      "last_edited_at",
      "revert_undo_window",
      "is_shared",
      "created_at",
      "updated_at",
      "received_from",
      "received_from_fingerprint",
      "received_at",
    ]) {
      expect(entity).not.toHaveProperty(dropped);
    }

    // entries carry only content fields, no ids / timestamps
    expect(entries[0]).not.toHaveProperty("id");
    expect(entries[0]).not.toHaveProperty("created_at");
    expect(entries[0]).not.toHaveProperty("updated_at");
  });

  it("includes one attachment per image with exact names and bytes", async () => {
    mockListImages.mockResolvedValue([
      { name: "gel-1.png" },
      { name: "spectrum 2.jpg" },
    ]);
    const bytesA = new Uint8Array([1, 2, 3]);
    const bytesB = new Uint8Array([9, 8, 7, 6]);
    mockReadFileAsBlob.mockImplementation(async (path: string) => {
      if (path.endsWith("gel-1.png")) return new Blob([bytesA]);
      if (path.endsWith("spectrum 2.jpg")) return new Blob([bytesB]);
      return null;
    });

    const input = await buildNoteBundleInput(makeNote(), "Grant");

    // listImagesInFolder is called with the note base path (it appends /Images).
    expect(mockListImages).toHaveBeenCalledWith("users/Grant/notes/42");
    expect(input.attachments).toHaveLength(2);
    expect(input.attachments[0].name).toBe("gel-1.png");
    expect(Array.from(input.attachments[0].bytes)).toEqual([1, 2, 3]);
    expect(input.attachments[1].name).toBe("spectrum 2.jpg");
    expect(Array.from(input.attachments[1].bytes)).toEqual([9, 8, 7, 6]);
  });

  it("returns no attachments when the Images folder is empty", async () => {
    mockListImages.mockResolvedValue([]);
    const input = await buildNoteBundleInput(makeNote(), "Grant");
    expect(input.attachments).toEqual([]);
    expect(mockReadFileAsBlob).not.toHaveBeenCalled();
  });
});

// ── importNoteBundle (materialize) ────────────────────────────────────────────

function makeValidResult(overrides: Partial<ReadBundleResult> = {}): ReadBundleResult {
  return {
    valid: true,
    shareUuid: "uuid-1",
    version: 1,
    entityType: "note",
    entity: {
      title: "Received note",
      description: "from a collaborator",
      is_running_log: false,
      notebook_id: "nb-from-wire",
      entries: [
        { title: "Body", date: "2026-06-01", content: "see ![x](Images/x.png)" },
      ],
      // foreign fields that must NOT be trusted
      id: 9999,
      username: "Stranger",
      shared_with: [{ username: "evil", level: "edit" }],
    },
    attachments: [{ name: "x.png", bytes: PNG_BYTES }],
    metadata: {},
    ...overrides,
  };
}

describe("importNoteBundle", () => {
  it("creates the note, stamps provenance + currentUser, writes attachments, returns id", async () => {
    mockCreate.mockResolvedValue(makeNote({ id: 7, username: "Recipient", entries: [] }));
    mockReadJson.mockResolvedValue(makeNote({ id: 7, username: "Recipient", entries: [] }));

    const result = makeValidResult();
    const { noteId } = await importNoteBundle(result, {
      currentUser: "Recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "AB:CD:EF",
    });

    expect(noteId).toBe(7);

    // notesApi.create called with sanitized content only (no foreign id/username).
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.title).toBe("Received note");
    expect(createArg.is_running_log).toBe(false);
    expect(createArg).not.toHaveProperty("id");
    expect(createArg).not.toHaveProperty("username");
    expect(createArg.entries?.[0].content).toBe("see ![x](Images/x.png)");

    // Provenance + username pinned to the recipient, written to the canonical path.
    expect(mockWriteJson).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    expect(writtenPath).toBe("users/Recipient/notes/7.json");
    expect(writtenRecord.username).toBe("Recipient");
    expect(writtenRecord.received_from).toBe("sender@lab.edu");
    expect(writtenRecord.received_from_fingerprint).toBe("AB:CD:EF");
    expect(typeof writtenRecord.received_at).toBe("string");
    expect(writtenRecord.notebook_id).toBe("nb-from-wire");

    // Attachment written under the NEW note's Images/ folder, same filename.
    expect(mockWriteFileFromBlob).toHaveBeenCalledTimes(1);
    const [imgPath] = mockWriteFileFromBlob.mock.calls[0];
    expect(imgPath).toBe("users/Recipient/notes/7/Images/x.png");
  });

  it("prefers an explicit notebookId override over the bundle's notebook_id", async () => {
    mockCreate.mockResolvedValue(makeNote({ id: 7, entries: [] }));
    mockReadJson.mockResolvedValue(makeNote({ id: 7, entries: [] }));

    await importNoteBundle(makeValidResult(), {
      currentUser: "Recipient",
      senderEmail: "s@e.edu",
      senderFingerprint: "FP",
      notebookId: "nb-chosen",
    });

    const [, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    expect(writtenRecord.notebook_id).toBe("nb-chosen");
  });

  it("throws InvalidBundleError when result.valid is false", async () => {
    const result = makeValidResult({ valid: false });
    await expect(
      importNoteBundle(result, {
        currentUser: "Recipient",
        senderEmail: "s@e.edu",
        senderFingerprint: "FP",
      }),
    ).rejects.toBeInstanceOf(InvalidBundleError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws InvalidBundleError when entityType is not 'note'", async () => {
    const result = makeValidResult({ entityType: "method" });
    await expect(
      importNoteBundle(result, {
        currentUser: "Recipient",
        senderEmail: "s@e.edu",
        senderFingerprint: "FP",
      }),
    ).rejects.toBeInstanceOf(InvalidBundleError);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── Round-trip through the REAL bundle engine ─────────────────────────────────

describe("round-trip buildNoteBundleInput -> buildBundle -> readBundle -> importNoteBundle", () => {
  it("preserves title, entries, and attachment bytes", async () => {
    const note = makeNote({
      title: "Round trip note",
      entries: [
        {
          id: "e1",
          title: "Step one",
          date: "2026-06-01",
          content: "mix ![p](Images/plate.png)",
          created_at: "x",
          updated_at: "y",
        },
      ],
    });
    const plateBytes = new Uint8Array([10, 20, 30, 40, 50]);

    // Collect: one real image off (mocked) disk.
    mockListImages.mockResolvedValue([{ name: "plate.png" }]);
    mockReadFileAsBlob.mockResolvedValue(new Blob([plateBytes]));

    const input = await buildNoteBundleInput(note, "Grant");

    // REAL serialize + verify.
    const zipBytes = await buildBundle(input);
    const read = await readBundle(zipBytes);
    expect(read.valid).toBe(true);
    expect(read.entityType).toBe("note");

    // Materialize into the recipient's folder.
    let capturedRecord: Note | null = null;
    mockCreate.mockImplementation(async (data) => {
      const fresh = makeNote({
        id: 3,
        username: "Recipient",
        title: data.title,
        description: data.description ?? "",
        is_running_log: data.is_running_log ?? false,
        entries: (data.entries ?? []).map((e, i) => ({
          id: `new-${i}`,
          title: e.title,
          date: e.date,
          content: e.content ?? "",
          created_at: "now",
          updated_at: "now",
        })),
      });
      capturedRecord = fresh;
      return fresh;
    });
    mockReadJson.mockImplementation(async () => capturedRecord);

    const { noteId } = await importNoteBundle(read, {
      currentUser: "Recipient",
      senderEmail: "collab@lab.edu",
      senderFingerprint: "ZZ",
    });

    expect(noteId).toBe(3);

    // Title + entry content survived the round trip.
    const written = mockWriteJson.mock.calls[0][1] as Note;
    expect(written.title).toBe("Round trip note");
    expect(written.entries[0].title).toBe("Step one");
    expect(written.entries[0].content).toBe("mix ![p](Images/plate.png)");
    expect(written.received_from).toBe("collab@lab.edu");

    // Attachment bytes survived the bundle and landed under the new note.
    const blobArg = mockWriteFileFromBlob.mock.calls[0][1] as Blob;
    const roundTripped = new Uint8Array(await blobArg.arrayBuffer());
    expect(Array.from(roundTripped)).toEqual([10, 20, 30, 40, 50]);
    expect(mockWriteFileFromBlob.mock.calls[0][0]).toBe(
      "users/Recipient/notes/3/Images/plate.png",
    );
  });
});
