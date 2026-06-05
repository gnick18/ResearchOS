/**
 * Tests for external-edit.ts (chunk 4, Phase 1 notes pilot).
 *
 * Each test group corresponds to one of the four external-edit branches:
 *   1. classify "none"   -- projection matches mirror, no edit detected.
 *   2. classify + ingest "clean" -- same entry ids, one entry field changed.
 *   3. classify + ingest "unclean" -- entry set changed (add or remove).
 *   4. conflict copy writer + shouldConflictCopy predicate.
 *
 * NOT covered here: the "sidecar entirely MISSING" case. That is handled by
 * chunk 2's loadOrRebuild (fresh reseed); we only classify edits when a sidecar
 * already exists.
 *
 * Commit-message verification uses doc.getAllChanges() to find the last change
 * across all peers and inspect its message field. This is the same API that
 * chunk 5 and the later VC reader will use.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { seedNoteDoc } from "../seed";
import { projectToNote } from "../mirror";
import {
  classifyExternalEdit,
  ingestExternalEdit,
  writeConflictCopy,
  shouldConflictCopy,
} from "../external-edit";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

function fixtureNote(): Note {
  return {
    id: 77,
    title: "PCR plate screen",
    description: "Colony picks from transformation",
    is_running_log: true,
    is_shared: false,
    created_at: "2026-05-10T08:00:00Z",
    updated_at: "2026-05-10T10:00:00Z",
    username: "grant",
    entries: [
      {
        id: "entry-a",
        title: "Plate 1",
        date: "2026-05-10",
        content: "24 colonies picked. Bands at 450 bp.\n\nPositive control OK.",
        created_at: "2026-05-10T08:00:00Z",
        updated_at: "2026-05-10T09:00:00Z",
      },
      {
        id: "entry-b",
        title: "Plate 2",
        date: "2026-05-10",
        content: "8 of 24 positive.",
        created_at: "2026-05-10T09:30:00Z",
        updated_at: "2026-05-10T10:00:00Z",
      },
    ],
  };
}

/** Seed a LoroDoc from a Note and import the snapshot. */
function seedDoc(note: Note): LoroDoc {
  const bytes = seedNoteDoc(note);
  const doc = new LoroDoc();
  doc.import(bytes);
  return doc;
}

/**
 * Return the message from the last commit across all peers.
 *
 * doc.getAllChanges() returns Map<PeerID, Change[]>. Each Change has a
 * `message: string | undefined`. We find the change with the highest
 * lamport clock to identify the most recent commit.
 *
 * This is the same approach chunk 5 and the VC reader use to inspect commit tags.
 */
function lastCommitMessage(doc: LoroDoc): string | undefined {
  const allChanges = doc.getAllChanges();
  let bestLamport = -1;
  let bestMessage: string | undefined;

  for (const changes of allChanges.values()) {
    for (const change of changes) {
      if (change.lamport > bestLamport) {
        bestLamport = change.lamport;
        bestMessage = change.message;
      }
    }
  }

  return bestMessage;
}

// ---------------------------------------------------------------------------
// Test 1: classify "none"
// ---------------------------------------------------------------------------

describe("classifyExternalEdit: no external edit", () => {
  it("returns 'none' when the sidecar projection equals the mirror", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);

    // Mirror is the projection of the doc itself (no external edit happened).
    const mirror = projectToNote(doc, note);

    expect(classifyExternalEdit(doc, mirror)).toBe("none");
  });

  it("returns 'none' when only untracked fields differ on the mirror", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);

    // Mirror with different untracked fields (updated_at at note level, username).
    // These are NOT in the CRDT tracked set, so classification should still be "none".
    const mirror: Note = {
      ...projectToNote(doc, note),
      is_shared: true,           // untracked
      username: "alice",         // untracked
    };

    expect(classifyExternalEdit(doc, mirror)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Test 2: classify + ingest "clean"
// ---------------------------------------------------------------------------

describe("classifyExternalEdit + ingestExternalEdit: clean branch", () => {
  it("classifies as 'clean' when one entry content changed", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    // Mirror has the same entry ids but entry-a content changed.
    const mirror: Note = {
      ...base,
      entries: base.entries.map((e) =>
        e.id === "entry-a"
          ? { ...e, content: "Updated band result: 450 bp confirmed." }
          : e,
      ),
    };

    expect(classifyExternalEdit(doc, mirror)).toBe("clean");
  });

  it("ingestExternalEdit(clean) updates entry content and commits 'external-edit'", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    const newContent = "Updated band result: 450 bp confirmed.";
    const mirror: Note = {
      ...base,
      entries: base.entries.map((e) =>
        e.id === "entry-a" ? { ...e, content: newContent } : e,
      ),
    };

    ingestExternalEdit(doc, mirror, "clean");

    // The doc's projection should now reflect the new content.
    const after = projectToNote(doc, base);
    const entryA = after.entries.find((e) => e.id === "entry-a");
    expect(entryA?.content).toBe(newContent);

    // The commit tag must be "external-edit".
    expect(lastCommitMessage(doc)).toBe("external-edit");
  });

  it("classifies as 'clean' when only an entry title changed", () => {
    // Title-only change: clean, because entry ids are unchanged and meta unchanged.
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    const mirror: Note = {
      ...base,
      entries: base.entries.map((e) =>
        e.id === "entry-b" ? { ...e, title: "Plate 2 (revised)" } : e,
      ),
    };

    expect(classifyExternalEdit(doc, mirror)).toBe("clean");
  });

  it("ingestExternalEdit(clean) updates entry title scalar correctly", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    const newTitle = "Plate 2 (revised)";
    const mirror: Note = {
      ...base,
      entries: base.entries.map((e) =>
        e.id === "entry-b" ? { ...e, title: newTitle } : e,
      ),
    };

    ingestExternalEdit(doc, mirror, "clean");

    const after = projectToNote(doc, base);
    const entryB = after.entries.find((e) => e.id === "entry-b");
    expect(entryB?.title).toBe(newTitle);
    expect(lastCommitMessage(doc)).toBe("external-edit");
  });
});

// ---------------------------------------------------------------------------
// Test 3: classify + ingest "unclean"
// ---------------------------------------------------------------------------

describe("classifyExternalEdit + ingestExternalEdit: unclean branch", () => {
  it("classifies as 'unclean' when a new entry was added", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    const mirror: Note = {
      ...base,
      entries: [
        ...base.entries,
        {
          id: "entry-c",
          title: "Plate 3",
          date: "2026-05-11",
          content: "New plate run.",
          created_at: "2026-05-11T08:00:00Z",
          updated_at: "2026-05-11T09:00:00Z",
        },
      ],
    };

    expect(classifyExternalEdit(doc, mirror)).toBe("unclean");
  });

  it("classifies as 'unclean' when an entry was removed", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    // Remove entry-b.
    const mirror: Note = {
      ...base,
      entries: base.entries.filter((e) => e.id !== "entry-b"),
    };

    expect(classifyExternalEdit(doc, mirror)).toBe("unclean");
  });

  it("classifies as 'unclean' when entries are reordered (same ids, different order)", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    // Reverse the entry order.
    const mirror: Note = {
      ...base,
      entries: [...base.entries].reverse(),
    };

    expect(classifyExternalEdit(doc, mirror)).toBe("unclean");
  });

  it("classifies as 'unclean' when meta title changed", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    const mirror: Note = { ...base, title: "PCR plate screen (updated)" };
    expect(classifyExternalEdit(doc, mirror)).toBe("unclean");
  });

  it("ingestExternalEdit(unclean) brings entry set in line and commits 'external-edit-uncleandiff'", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    // Mirror added a third entry.
    const newEntry = {
      id: "entry-c",
      title: "Plate 3",
      date: "2026-05-11",
      content: "Follow-up screen.",
      created_at: "2026-05-11T08:00:00Z",
      updated_at: "2026-05-11T09:00:00Z",
    };
    const mirror: Note = {
      ...base,
      entries: [...base.entries, newEntry],
    };

    ingestExternalEdit(doc, mirror, "unclean");

    const after = projectToNote(doc, base);
    // Entry count matches the mirror.
    expect(after.entries).toHaveLength(3);
    // The new entry is present.
    expect(after.entries.find((e) => e.id === "entry-c")).toBeDefined();
    expect(after.entries.find((e) => e.id === "entry-c")?.content).toBe(
      "Follow-up screen.",
    );
    // Commit tag is correct.
    expect(lastCommitMessage(doc)).toBe("external-edit-uncleandiff");
  });

  it("ingestExternalEdit(unclean) removes entries not present in the mirror", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    // Mirror has only entry-a.
    const mirror: Note = {
      ...base,
      entries: base.entries.filter((e) => e.id === "entry-a"),
    };

    ingestExternalEdit(doc, mirror, "unclean");

    const after = projectToNote(doc, base);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0].id).toBe("entry-a");
    expect(lastCommitMessage(doc)).toBe("external-edit-uncleandiff");
  });

  it("ingestExternalEdit(unclean) updates meta in the doc", () => {
    const note = fixtureNote();
    const doc = seedDoc(note);
    const base = projectToNote(doc, note);

    const mirror: Note = {
      ...base,
      title: "PCR plate screen (final)",
      description: "Colony pick results, final tally",
    };

    ingestExternalEdit(doc, mirror, "unclean");

    const after = projectToNote(doc, base);
    expect(after.title).toBe("PCR plate screen (final)");
    expect(after.description).toBe("Colony pick results, final tally");
    expect(lastCommitMessage(doc)).toBe("external-edit-uncleandiff");
  });
});

// ---------------------------------------------------------------------------
// Test 4: conflict copy writer + shouldConflictCopy predicate
// ---------------------------------------------------------------------------

vi.mock("@/lib/file-system/file-service", () => {
  const fileService = {
    writeJson: vi.fn().mockResolvedValue(undefined),
    readFileAsBlob: vi.fn().mockResolvedValue(null),
    writeFileFromBlob: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(null),
  };
  return { fileService };
});

async function getMockFileService() {
  const mod = await import("@/lib/file-system/file-service");
  return mod.fileService as unknown as {
    writeJson: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("writeConflictCopy: writes to the locked conflict-copy path", () => {
  it("calls fileService.writeJson with the exact conflict-copy path and payload", async () => {
    const fs = await getMockFileService();

    const owner = "grant";
    const base = fixtureNote();
    const externalNote: Note = {
      ...base,
      title: "PCR plate screen (external edit version)",
      entries: [
        ...base.entries,
        {
          id: "entry-c",
          title: "Plate 3",
          date: "2026-05-11",
          content: "Added externally.",
          created_at: "2026-05-11T08:00:00Z",
          updated_at: "2026-05-11T09:00:00Z",
        },
      ],
    };

    await writeConflictCopy(owner, base, externalNote);

    expect(fs.writeJson).toHaveBeenCalledTimes(1);

    // Path must match the locked naming from section 9, decision 3.
    const path = fs.writeJson.mock.calls[0][0] as string;
    expect(path).toBe(`users/${owner}/notes/${base.id} (external edit).json`);

    // Payload must be the externalNote verbatim.
    const payload = fs.writeJson.mock.calls[0][1] as Note;
    expect(payload.title).toBe(externalNote.title);
    expect(payload.entries).toHaveLength(externalNote.entries.length);
  });
});

describe("shouldConflictCopy: pure predicate", () => {
  it("returns true when there are pending in-app edits and a clean external edit", () => {
    expect(shouldConflictCopy(true, "clean")).toBe(true);
  });

  it("returns true when there are pending in-app edits and an unclean external edit", () => {
    expect(shouldConflictCopy(true, "unclean")).toBe(true);
  });

  it("returns false when there are no pending in-app edits (even with a clean external edit)", () => {
    expect(shouldConflictCopy(false, "clean")).toBe(false);
  });

  it("returns false when there are no pending in-app edits and an unclean external edit", () => {
    expect(shouldConflictCopy(false, "unclean")).toBe(false);
  });

  it("returns false when kind is 'none' even if there are pending edits", () => {
    expect(shouldConflictCopy(true, "none")).toBe(false);
  });
});
