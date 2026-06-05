/**
 * Tests for store.ts (chunk 5: the store facade).
 *
 * fileService is mocked (hoisted) so the tests run in the node vitest
 * environment without needing a real File System Access handle.
 *
 * Test plan:
 *   1. openNote ingests an external edit at open.
 *   2. commit stamps updated_at and persists (flush path).
 *   3. Handle caching: two openNote calls for same owner+id return the same handle.
 *   4. close() flushes any pending debounced commit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { seedNoteDoc } from "../seed";
import { sidecarPath } from "../sidecar-store";
import type { Note, NoteComment } from "@/lib/types";

// ---------------------------------------------------------------------------
// fileService mock (hoisted -- must appear before any imports that touch it)
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

async function getMocks() {
  const mod = await import("@/lib/file-system/file-service");
  return mod.fileService as unknown as {
    ensureDir: ReturnType<typeof vi.fn>;
    writeFileFromBlob: ReturnType<typeof vi.fn>;
    writeJson: ReturnType<typeof vi.fn>;
    readFileAsBlob: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function fixtureNote(overrides?: Partial<Note>): Note {
  return {
    id: 77,
    title: "PCR protocol draft",
    description: "Amplification conditions for primer set A",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-05-10T08:00:00Z",
    updated_at: "2026-05-10T09:00:00Z",
    username: "mira",
    comments: [] as NoteComment[],
    flagged: null,
    entries: [
      {
        id: "entry-1",
        title: "Draft 1",
        date: "2026-05-10",
        content: "Initial annealing temp: 58°C",
        created_at: "2026-05-10T08:00:00Z",
        updated_at: "2026-05-10T09:00:00Z",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();
  const mocks = await getMocks();
  // Default: sidecar missing (null = file not found).
  mocks.readFileAsBlob.mockResolvedValue(null);
  mocks.ensureDir.mockResolvedValue(null);
  mocks.writeFileFromBlob.mockResolvedValue(undefined);
  mocks.writeJson.mockResolvedValue(undefined);

  // Clear the handle cache between tests so each test starts fresh.
  const { _clearCache } = await import("../store");
  _clearCache();
});

// ---------------------------------------------------------------------------
// Test 1: openNote ingests an external edit at open
// ---------------------------------------------------------------------------

describe("openNote: external edit ingested at open", () => {
  it("reflects mirror content in the doc when mirror updated_at is newer", async () => {
    const { openNote } = await import("../store");
    const { projectToNote } = await import("../mirror");
    const mocks = await getMocks();

    // Build a sidecar doc whose projected note has an OLDER updated_at.
    const base = fixtureNote({
      updated_at: "2026-05-10T09:00:00Z",
    });
    const sidecarBytes = seedNoteDoc(base);
    const sidecarBlob = new Blob([sidecarBytes.buffer as ArrayBuffer]);
    mocks.readFileAsBlob.mockResolvedValue(sidecarBlob);

    // The mirror note that openNote receives is NEWER -- it was edited externally.
    const mirrorNote = fixtureNote({
      updated_at: "2026-05-11T10:00:00Z",
      entries: [
        {
          id: "entry-1",
          title: "Draft 1",
          date: "2026-05-10",
          content: "Annealing temp revised: 60°C",
          created_at: "2026-05-10T08:00:00Z",
          updated_at: "2026-05-11T10:00:00Z",
        },
      ],
    });

    const handle = await openNote(mirrorNote, "mira");

    // The projected doc must now reflect the externally-edited content.
    const projected = projectToNote(handle.doc, mirrorNote);
    expect(projected.entries[0].content).toBe("Annealing temp revised: 60°C");

    // Verify the commit message was stamped by checking the Loro op log.
    // We export and re-import to inspect the version vector; simpler is to
    // assert the content changed (above), which confirms ingestion happened.
    // Additionally verify the doc has more than the seed commit by checking
    // that the state differs from a pure seed.
    const seedOnlyDoc = new LoroDoc();
    seedOnlyDoc.import(seedNoteDoc(base));
    const seedProjected = projectToNote(seedOnlyDoc, base);
    // Seed has the old content; handle.doc has the external-edit content.
    expect(seedProjected.entries[0].content).not.toBe(
      projected.entries[0].content,
    );
  });

  it("does not ingest when mirror is not newer than sidecar projection", async () => {
    const { openNote } = await import("../store");
    const { projectToNote } = await import("../mirror");
    const mocks = await getMocks();

    const base = fixtureNote({ updated_at: "2026-05-10T09:00:00Z" });
    const sidecarBytes = seedNoteDoc(base);
    mocks.readFileAsBlob.mockResolvedValue(
      new Blob([sidecarBytes.buffer as ArrayBuffer]),
    );

    // Mirror note has the SAME updated_at as the sidecar projection.
    const handle = await openNote(base, "mira");
    const projected = projectToNote(handle.doc, base);

    // Content should be whatever the sidecar has (original seed content).
    expect(projected.entries[0].content).toBe(base.entries[0].content);
  });
});

// ---------------------------------------------------------------------------
// Test 2: commit stamps updated_at and persists
// ---------------------------------------------------------------------------

describe("commit (via flush): stamps updated_at and calls persistNote", () => {
  it("calls writeFileFromBlob (sidecar) and writeJson (mirror) after flush", async () => {
    const { openNote } = await import("../store");
    const mocks = await getMocks();

    const note = fixtureNote();
    const handle = await openNote(note, "mira");

    const before = Date.now();
    await handle.commit(note);
    await handle.flush();
    const after = Date.now();

    // Both I/O calls must have happened.
    expect(mocks.writeFileFromBlob).toHaveBeenCalledTimes(1);
    expect(mocks.writeJson).toHaveBeenCalledTimes(1);

    // Sidecar path must be correct.
    const sidecarArg = mocks.writeFileFromBlob.mock.calls[0][0] as string;
    expect(sidecarArg).toBe(sidecarPath("mira", note.id));

    // Mirror path must be correct.
    const mirrorArg = mocks.writeJson.mock.calls[0][0] as string;
    expect(mirrorArg).toBe(`users/mira/notes/${note.id}.json`);

    // The written mirror note must have a fresh updated_at (different from base).
    const writtenNote = mocks.writeJson.mock.calls[0][1] as Note;
    expect(writtenNote.updated_at).not.toBe(note.updated_at);
    const writtenMs = Date.parse(writtenNote.updated_at);
    expect(writtenMs).toBeGreaterThanOrEqual(before);
    expect(writtenMs).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Test 3: handle caching
// ---------------------------------------------------------------------------

describe("openNote: handle caching", () => {
  it("returns the same handle object for two openNote calls with the same owner+id", async () => {
    const { openNote } = await import("../store");

    const note = fixtureNote();
    const handleA = await openNote(note, "mira");
    const handleB = await openNote(note, "mira");

    // Must be the exact same object (same doc reference).
    expect(handleA).toBe(handleB);
    expect(handleA.doc).toBe(handleB.doc);
  });

  it("returns different handles for different owners", async () => {
    const { openNote } = await import("../store");

    const note = fixtureNote();
    const handleA = await openNote(note, "mira");
    const handleB = await openNote(note, "alex");

    expect(handleA).not.toBe(handleB);
  });

  it("returns a fresh handle after close() evicts the cache entry", async () => {
    const { openNote } = await import("../store");

    const note = fixtureNote();
    const handleA = await openNote(note, "mira");
    await handleA.close();

    const handleB = await openNote(note, "mira");
    expect(handleA).not.toBe(handleB);
  });
});

// ---------------------------------------------------------------------------
// Test 4: close() flushes a pending debounced commit
// ---------------------------------------------------------------------------

describe("close: flushes pending debounced commit", () => {
  it("calls persistNote before resolving even if the 600 ms timer has not fired", async () => {
    const { openNote } = await import("../store");
    const mocks = await getMocks();

    const note = fixtureNote();
    const handle = await openNote(note, "mira");

    // Queue a commit (starts the 600 ms debounce timer).
    void handle.commit(note);

    // Close immediately -- should flush the pending commit synchronously.
    await handle.close();

    // Both I/O calls must have fired (flush ran before the timer expired).
    expect(mocks.writeFileFromBlob).toHaveBeenCalledTimes(1);
    expect(mocks.writeJson).toHaveBeenCalledTimes(1);
  });
});
