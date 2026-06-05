/**
 * Auto-save safety proof (auto-save bot, 2026-06-05).
 *
 * Verifies that editing a note's TITLE (and DESCRIPTION) under the Loro pilot
 * persists to disk WITHOUT any explicit "Save note" button click. Under the
 * pilot, `syncNoteMetadataToDoc` is called inside `_runCommit` (which runs on
 * the debounced commit triggered by body edits, and also runs immediately via
 * `flush()`), so a title/description change is captured in the CRDT and the
 * resulting mirror reflects the new value.
 *
 * This is the correctness proof that makes removing the Save button safe:
 * title + description reach disk through the Loro commit path, not through the
 * button.
 *
 * Test plan:
 *   1. Auto-persist title: open a note, change the title on the base note (as
 *      the popup does when the user edits the title input), call flush() to
 *      simulate the debounced commit running, and assert that the written
 *      mirror note carries the new title WITHOUT any Save button involvement.
 *
 *   2. Auto-persist description: same proof for the description field.
 *
 *   3. commitPending signal: assert that commitPending flips true on commit()
 *      and false once flush() resolves (the Saving/Saved indicator source).
 *
 *   4. beforeunload flush path: flush() with a pending commit writes to disk
 *      (belt-and-suspenders proof that the close/unmount path drains correctly).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { seedNoteDoc } from "../seed";
import type { Note, NoteComment } from "@/lib/types";

// ---------------------------------------------------------------------------
// fileService mock (hoisted)
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
    id: 42,
    title: "PCR annealing screen",
    description: "Testing Tm 58-65 C range",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-06-05T08:00:00Z",
    updated_at: "2026-06-05T09:00:00Z",
    username: "grant",
    comments: [] as NoteComment[],
    flagged: null,
    entries: [
      {
        id: "entry-1",
        title: "Experiment 1",
        date: "2026-06-05",
        content: "Initial annealing temp: 58 C",
        created_at: "2026-06-05T08:00:00Z",
        updated_at: "2026-06-05T09:00:00Z",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks();
  const mocks = await getMocks();
  mocks.readFileAsBlob.mockResolvedValue(null);
  mocks.ensureDir.mockResolvedValue(null);
  mocks.writeFileFromBlob.mockResolvedValue(undefined);
  mocks.writeJson.mockResolvedValue(undefined);

  const { _clearCache } = await import("../store");
  _clearCache();
});

// ---------------------------------------------------------------------------
// Test 1: title auto-persists WITHOUT a Save button click
// ---------------------------------------------------------------------------

describe("auto-persist: title persists via flush, no Save button required", () => {
  it("writes the new title to the mirror after flush() with no explicit save call", async () => {
    const { openNote } = await import("../store");
    const mocks = await getMocks();

    const base = fixtureNote();
    // Provide the sidecar bytes so loadOrRebuild does not rebuild from scratch.
    const sidecarBytes = seedNoteDoc(base);
    mocks.readFileAsBlob.mockResolvedValue(
      new Blob([sidecarBytes.buffer as ArrayBuffer]),
    );

    const handle = await openNote(base, "grant");

    // Simulate the user editing the title (popup sets the local `title` state
    // and the `base` note used for the next commit carries the new title).
    const updatedNote: Note = { ...base, title: "PCR annealing screen REVISED" };

    // Queue a commit with the updated base (mirrors what InlineMarkdownEditor
    // does on every keystroke when the pilot is on).
    await handle.commit(updatedNote);

    // Flush immediately (same path as the close/unmount belt-and-suspenders)
    // WITHOUT any "Save note" button interaction.
    await handle.flush();

    // The mirror note written to disk must carry the new title.
    const mirrorCalls = mocks.writeJson.mock.calls.filter(
      (c) => (c[0] as string) === `users/grant/notes/${base.id}.json`,
    );
    expect(mirrorCalls.length).toBeGreaterThanOrEqual(1);
    const writtenNote = mirrorCalls[mirrorCalls.length - 1][1] as Note;
    expect(writtenNote.title).toBe("PCR annealing screen REVISED");
  });
});

// ---------------------------------------------------------------------------
// Test 2: description auto-persists WITHOUT a Save button click
// ---------------------------------------------------------------------------

describe("auto-persist: description persists via flush, no Save button required", () => {
  it("writes the new description to the mirror after flush(), no Save button", async () => {
    const { openNote } = await import("../store");
    const mocks = await getMocks();

    const base = fixtureNote();
    const sidecarBytes = seedNoteDoc(base);
    mocks.readFileAsBlob.mockResolvedValue(
      new Blob([sidecarBytes.buffer as ArrayBuffer]),
    );

    const handle = await openNote(base, "grant");

    // User edits the description field (popup header input).
    const updatedNote: Note = {
      ...base,
      description: "Updated: Tm 60 C was optimal",
    };

    await handle.commit(updatedNote);
    await handle.flush();

    const mirrorCalls = mocks.writeJson.mock.calls.filter(
      (c) => (c[0] as string) === `users/grant/notes/${base.id}.json`,
    );
    expect(mirrorCalls.length).toBeGreaterThanOrEqual(1);
    const writtenNote = mirrorCalls[mirrorCalls.length - 1][1] as Note;
    expect(writtenNote.description).toBe("Updated: Tm 60 C was optimal");
  });
});

// ---------------------------------------------------------------------------
// Test 3: commitPending signal drives the Saving/Saved indicator
// ---------------------------------------------------------------------------

describe("commitPending: flips true on commit(), false after flush()", () => {
  it("starts false, goes true on commit, returns false after flush", async () => {
    const { openNote } = await import("../store");
    const mocks = await getMocks();

    const base = fixtureNote();
    const sidecarBytes = seedNoteDoc(base);
    mocks.readFileAsBlob.mockResolvedValue(
      new Blob([sidecarBytes.buffer as ArrayBuffer]),
    );

    const handle = await openNote(base, "grant");

    // Before any commit, the indicator must read settled.
    expect(handle.commitPending).toBe(false);

    // Track what the subscription fires.
    const events: boolean[] = [];
    // subscribeCommitPending fires immediately with current value.
    const unsub = handle.subscribeCommitPending((v) => events.push(v));

    // The immediate fire should report false (settled at open).
    expect(events).toEqual([false]);

    // Queue a commit: timer starts, commitPending must flip true.
    await handle.commit(base);
    expect(handle.commitPending).toBe(true);
    expect(events).toEqual([false, true]);

    // Flush drains the commit; commitPending must return to false.
    await handle.flush();
    expect(handle.commitPending).toBe(false);
    expect(events).toEqual([false, true, false]);

    unsub();
  });
});

// ---------------------------------------------------------------------------
// Test 4: flush() on close drains pending commit (belt-and-suspenders)
// ---------------------------------------------------------------------------

describe("auto-persist belt-and-suspenders: close() flushes a pending title edit", () => {
  it("a pending title commit reaches disk when the popup closes (via close flush)", async () => {
    const { openNote } = await import("../store");
    const mocks = await getMocks();

    const base = fixtureNote();
    const sidecarBytes = seedNoteDoc(base);
    mocks.readFileAsBlob.mockResolvedValue(
      new Blob([sidecarBytes.buffer as ArrayBuffer]),
    );

    const handle = await openNote(base, "grant");

    // Queue a commit with a title change (debounce timer running).
    const renamed: Note = { ...base, title: "Saved on close, not via button" };
    await handle.commit(renamed);

    // Close the handle immediately (simulates the popup unmounting before the
    // 600 ms debounce fires). Close flushes the pending commit.
    await handle.close();

    const mirrorCalls = mocks.writeJson.mock.calls.filter(
      (c) => (c[0] as string) === `users/grant/notes/${base.id}.json`,
    );
    expect(mirrorCalls.length).toBeGreaterThanOrEqual(1);
    const writtenNote = mirrorCalls[mirrorCalls.length - 1][1] as Note;
    expect(writtenNote.title).toBe("Saved on close, not via button");
  });
});
