// Tests for Phase 3c chunk 3a: collab_doc_id travels in the note bundle.
//
// These tests verify that:
//   1. buildNoteBundleInput carries collab_doc_id when provided via opts.
//   2. importNoteBundle writes collab_doc_id into the Note JSON record so the
//      recipient's NoteDetailPopup can seed the Loro meta and auto-connect.
//   3. When no collab_doc_id is present (unshared note), nothing is written.
//
// All disk + API calls are mocked. The round-trip test exercises the REAL
// buildBundle / readBundle (pure functions) to confirm the id survives
// serialization.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildNoteBundleInput,
  importNoteBundle,
} from "@/lib/sharing/note-transfer";
import { buildBundle, readBundle } from "@/lib/sharing/bundle";
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

vi.mock("@/lib/sharing/identity/sidecar", () => ({
  readSharingIdentity: vi.fn(),
}));

import { listImagesInFolder } from "@/lib/attachments/image-folder";
import { fileService } from "@/lib/file-system/file-service";
import { notesApi } from "@/lib/local-api";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";

const mockListImages = vi.mocked(listImagesInFolder);
const mockReadJson = vi.mocked(fileService.readJson);
const mockWriteJson = vi.mocked(fileService.writeJson);
const mockCreate = vi.mocked(notesApi.create);
vi.mocked(readSharingIdentity).mockResolvedValue(null);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_DOC_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 42,
    title: "Collab test note",
    description: "Phase 3c test",
    is_running_log: false,
    is_shared: false,
    entries: [
      {
        id: "entry-1",
        title: "Body",
        date: "2026-06-05",
        content: "Some content",
        created_at: "2026-06-05T10:00:00.000Z",
        updated_at: "2026-06-05T10:00:00.000Z",
      },
    ],
    created_at: "2026-06-05T09:00:00.000Z",
    updated_at: "2026-06-05T10:00:00.000Z",
    username: "Grant",
    shared_with: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListImages.mockResolvedValue([]);
  vi.mocked(readSharingIdentity).mockResolvedValue(null);
});

// ── buildNoteBundleInput: collab_doc_id travels ─────────────────────────────

describe("buildNoteBundleInput with collab_doc_id", () => {
  it("includes collab_doc_id in the entity when provided via opts", async () => {
    const input = await buildNoteBundleInput(makeNote(), "Grant", {
      collabDocId: TEST_DOC_ID,
    });
    const entity = input.entity as Record<string, unknown>;
    expect(entity.collab_doc_id).toBe(TEST_DOC_ID);
  });

  it("omits collab_doc_id when no opts are passed (unshared note)", async () => {
    const input = await buildNoteBundleInput(makeNote(), "Grant");
    const entity = input.entity as Record<string, unknown>;
    expect(entity).not.toHaveProperty("collab_doc_id");
  });

  it("omits collab_doc_id when opts is passed but collabDocId is absent", async () => {
    const input = await buildNoteBundleInput(makeNote(), "Grant", {});
    const entity = input.entity as Record<string, unknown>;
    expect(entity).not.toHaveProperty("collab_doc_id");
  });

  it("does not mutate the original note object", async () => {
    const note = makeNote();
    await buildNoteBundleInput(note, "Grant", { collabDocId: TEST_DOC_ID });
    // The original note should not have been modified.
    expect((note as unknown as Record<string, unknown>).collab_doc_id).toBeUndefined();
  });
});

// ── importNoteBundle: collab_doc_id written to the JSON record ───────────────

function makeCreatedNote(id: number): Note {
  return makeNote({ id, username: "Recipient", entries: [] });
}

describe("importNoteBundle with collab_doc_id", () => {
  it("writes collab_doc_id to the Note JSON record when present in the bundle", async () => {
    mockCreate.mockResolvedValue(makeCreatedNote(7));
    mockReadJson.mockResolvedValue(makeCreatedNote(7));

    const result = {
      valid: true as const,
      shareUuid: "share-uuid",
      version: 1,
      entityType: "note" as const,
      entity: {
        title: "Shared note",
        description: "",
        is_running_log: false,
        entries: [],
        collab_doc_id: TEST_DOC_ID,
      },
      attachments: [],
      metadata: {},
    };

    await importNoteBundle(result, {
      currentUser: "Recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP",
    });

    expect(mockWriteJson).toHaveBeenCalledTimes(1);
    const [, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    expect(writtenRecord.collab_doc_id).toBe(TEST_DOC_ID);
  });

  it("does not write collab_doc_id when absent from the bundle (unshared note)", async () => {
    mockCreate.mockResolvedValue(makeCreatedNote(7));
    mockReadJson.mockResolvedValue(makeCreatedNote(7));

    const result = {
      valid: true as const,
      shareUuid: "share-uuid",
      version: 1,
      entityType: "note" as const,
      entity: {
        title: "No-collab note",
        description: "",
        is_running_log: false,
        entries: [],
        // no collab_doc_id
      },
      attachments: [],
      metadata: {},
    };

    await importNoteBundle(result, {
      currentUser: "Recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP",
    });

    const [, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    expect(writtenRecord.collab_doc_id).toBeUndefined();
  });
});

// ── Round-trip: collab_doc_id survives buildBundle / readBundle ───────────────

describe("round-trip: collab_doc_id survives bundle serialization", () => {
  it("carries the doc id through buildBundle -> readBundle -> importNoteBundle", async () => {
    const note = makeNote({ title: "Collab round-trip" });
    mockListImages.mockResolvedValue([]);

    // Collect with a collab doc id.
    const input = await buildNoteBundleInput(note, "Grant", {
      collabDocId: TEST_DOC_ID,
    });

    // REAL serialize + verify.
    const zipBytes = await buildBundle(input);
    const read = await readBundle(zipBytes);
    expect(read.valid).toBe(true);

    // Materialize into the recipient's folder.
    let capturedRecord: Note | null = null;
    mockCreate.mockImplementation(async (data) => {
      const fresh = makeNote({
        id: 99,
        username: "Recipient",
        title: data.title,
        description: data.description ?? "",
        is_running_log: data.is_running_log ?? false,
        entries: [],
      });
      capturedRecord = fresh;
      return fresh;
    });
    mockReadJson.mockImplementation(async () => capturedRecord);

    await importNoteBundle(read, {
      currentUser: "Recipient",
      senderEmail: "collab@lab.edu",
      senderFingerprint: "ZZ",
    });

    const written = mockWriteJson.mock.calls[0][1] as unknown as Note;
    expect(written.collab_doc_id).toBe(TEST_DOC_ID);
  });
});
