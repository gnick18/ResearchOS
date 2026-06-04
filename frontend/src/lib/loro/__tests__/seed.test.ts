import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { seedNoteDoc } from "../seed";
import { getMeta, listEntries } from "../note-doc";
import type { Note } from "@/lib/types";

// A representative running-log note with multiple entries and real markdown
// content. Marks-in-sidecar (bold/italic) is chunk 3, so the content here is
// plain text that round-trips as-is.
function fixtureNote(): Note {
  return {
    id: 42,
    title: "Growth curve QC",
    description: "OD600 plate-reader runs for the inducer titration",
    is_running_log: true,
    is_shared: false,
    created_at: "2026-04-29T14:03:00Z",
    entries: [
      {
        id: "entry-b",
        title: "Run 2 replicate",
        date: "2026-04-30",
        content: "Replicate of run 1.\n\nBlank wells A1, A2.\nOD plateau at ~0.8.",
        created_at: "2026-04-30T09:15:00Z",
        updated_at: "2026-04-30T09:40:00Z",
      },
      {
        id: "entry-a",
        title: "Run 1",
        date: "2026-04-29",
        content: "# Setup\n\n96-well, DemoStrain.\nLog phase 2-6h.",
        created_at: "2026-04-29T14:03:00Z",
        updated_at: "2026-04-29T16:20:00Z",
      },
    ],
  } as Note;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe("seedNoteDoc determinism (the fork-pitfall gate)", () => {
  it("produces byte-identical snapshots for two independent seeds of the same note", () => {
    // Two separate calls simulate two devices seeding from the same legacy file.
    const a = seedNoteDoc(fixtureNote());
    const b = seedNoteDoc(fixtureNote());
    expect(bytesEqual(a, b)).toBe(true);
  });

  it("is invariant to the input entries array order (canonical sort by id)", () => {
    const note = fixtureNote();
    const shuffled = fixtureNote();
    // Reverse the entries so the input order differs from the first call.
    shuffled.entries = [...note.entries].reverse();

    const fromNote = seedNoteDoc(note);
    const fromShuffled = seedNoteDoc(shuffled);
    expect(bytesEqual(fromNote, fromShuffled)).toBe(true);
  });
});

describe("seedNoteDoc round-trip (migrate-on-open is lossless)", () => {
  it("reconstructs the tracked note fields after import", () => {
    const note = fixtureNote();
    const bytes = seedNoteDoc(note);

    // Import into a fresh doc, the real migrate-on-open path.
    const doc = new LoroDoc();
    doc.import(bytes);

    const meta = getMeta(doc);
    expect(meta.title).toBe(note.title);
    expect(meta.description).toBe(note.description);
    expect(meta.is_running_log).toBe(note.is_running_log);
    expect(meta.created_at).toBe(note.created_at);

    // Entries come back in canonical (id-sorted) order, so compare against the
    // same sort the seed applies.
    const expectedEntries = [...note.entries].sort((x, y) =>
      x.id < y.id ? -1 : x.id > y.id ? 1 : 0,
    );
    const got = listEntries(doc);
    expect(got.length).toBe(expectedEntries.length);

    for (let i = 0; i < expectedEntries.length; i++) {
      const e = expectedEntries[i];
      expect(got[i].id).toBe(e.id);
      expect(got[i].title).toBe(e.title);
      expect(got[i].date).toBe(e.date);
      expect(got[i].created_at).toBe(e.created_at);
      expect(got[i].updated_at).toBe(e.updated_at);
      expect(got[i].content).toBe(e.content);
    }
  });
});
