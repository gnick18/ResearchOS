/**
 * Tests for chunk 3: marks-in-sidecar (Peritext bold/italic/link).
 *
 * Test plan (per the orchestrator spec):
 *   1. Split/render round-trip (pure). Bold, italic, link, mixed line, block-level
 *      constructs, and a not-cleanly-supported construct (nested bold+link).
 *   2. No control chars in the CRDT Text. Seed "**bold** word" and assert the
 *      LoroText contains NO '*' characters.
 *   3. Marks survive the full storage round-trip. Seed, export, import fresh doc,
 *      listEntries returns original markdown.
 *   4. Seed determinism holds WITH marks. Two independent seeds produce byte-equal
 *      exports.
 *   5. Existing seed.test.ts stays green (not re-run here, but the import of seed
 *      confirms no signature change).
 */

import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import { splitMarkdownInline, renderMarkdownInline } from "../marks";
import { seedNoteDoc } from "../seed";
import { getEntryContentText, listEntries } from "../note-doc";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function minimalNote(content: string): Note {
  return {
    id: 1,
    title: "Test note",
    description: "",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-01-01T00:00:00Z",
    entries: [
      {
        id: "entry-a",
        title: "Entry",
        date: "2026-01-01",
        content,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
  } as Note;
}

// ---------------------------------------------------------------------------
// Test 1: split/render round-trip (pure functions, no CRDT)
// ---------------------------------------------------------------------------

describe("splitMarkdownInline / renderMarkdownInline: round-trips", () => {
  it("round-trips plain text (no marks)", () => {
    const md = "just some plain text";
    expect(renderMarkdownInline(...Object.values(splitMarkdownInline(md)) as [string, import("../marks").InlineMark[]])).toBe(md);
  });

  it("round-trips bold: **text**", () => {
    const md = "before **bold word** after";
    const { text, marks } = splitMarkdownInline(md);
    expect(text).toBe("before bold word after");
    expect(marks).toHaveLength(1);
    expect(marks[0].type).toBe("bold");
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("round-trips italic: *text*", () => {
    const md = "see *this* here";
    const { text, marks } = splitMarkdownInline(md);
    expect(text).toBe("see this here");
    expect(marks).toHaveLength(1);
    expect(marks[0].type).toBe("italic");
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("round-trips link: [label](url)", () => {
    const md = "visit [ResearchOS](https://example.com) today";
    const { text, marks } = splitMarkdownInline(md);
    expect(text).toBe("visit ResearchOS today");
    expect(marks).toHaveLength(1);
    expect(marks[0].type).toBe("link");
    expect(marks[0].url).toBe("https://example.com");
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("round-trips a mixed line with bold, italic, and link", () => {
    const md = "**bold** and *italic* and [a](http://x)";
    const { text, marks } = splitMarkdownInline(md);
    // Plain text has no control characters.
    expect(text).toBe("bold and italic and a");
    expect(marks).toHaveLength(3);
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("leaves block-level markdown (heading + list) completely unchanged", () => {
    const md = "# H\n\n- a\n- b";
    const { text, marks } = splitMarkdownInline(md);
    // Block markdown is left verbatim in the text layer.
    expect(text).toBe(md);
    expect(marks).toHaveLength(0);
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("does NOT corrupt a nested bold-link construct (leaves it literal)", () => {
    // **[a](b)** cannot be cleanly round-tripped; the round-trip-or-leave-literal
    // rule dictates we leave it as-is in the text rather than corrupt it.
    const md = "**[a](b)**";
    const { text, marks } = splitMarkdownInline(md);
    // Whatever the parser decides (literal or partial), it must round-trip.
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("leaves a literal asterisk in plain text untouched", () => {
    // A standalone '*' with no matching close should not be lifted into a mark.
    const md = "2 * 3 = 6";
    const { text, marks } = splitMarkdownInline(md);
    expect(text).toBe(md);
    expect(marks).toHaveLength(0);
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("leaves underscore-style italic (_text_) as literal text", () => {
    // Phase 1 only supports asterisk italic; underscore form is left literal.
    const md = "_italic_";
    const { text, marks } = splitMarkdownInline(md);
    expect(text).toBe(md);
    expect(marks).toHaveLength(0);
    expect(renderMarkdownInline(text, marks)).toBe(md);
  });

  it("marks are sorted by (start asc, type asc)", () => {
    const md = "*a* **b**";
    const { marks } = splitMarkdownInline(md);
    for (let i = 1; i < marks.length; i++) {
      const prev = marks[i - 1];
      const curr = marks[i];
      const ordered =
        prev.start < curr.start ||
        (prev.start === curr.start && prev.type <= curr.type);
      expect(ordered).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: content is stored as VERBATIM markdown in the LoroText
//
// The Loro Text holds the raw markdown syntax characters (the `**` / `*` /
// link brackets are IN the text), matching how the live CodeMirror editor
// stores content. This replaced the earlier plain-text-plus-marks split, which
// produced a second representation the editor's re-seed (text.toString) could
// not read, so a restore lost bold.
// ---------------------------------------------------------------------------

describe("content is stored as verbatim markdown in the LoroText", () => {
  it("'**bold** word' is stored verbatim (the ** stays in the text)", () => {
    const note = minimalNote("**bold** word");
    const bytes = seedNoteDoc(note);

    const doc = new LoroDoc();
    doc.import(bytes);

    const rawText = getEntryContentText(doc, 0);
    expect(rawText).toBeDefined();
    expect(rawText!.toString()).toBe("**bold** word");
  });

  it("'*italic* text' is stored verbatim", () => {
    const note = minimalNote("*italic* text");
    const bytes = seedNoteDoc(note);

    const doc = new LoroDoc();
    doc.import(bytes);

    expect(getEntryContentText(doc, 0)!.toString()).toBe("*italic* text");
  });

  it("[link](url) is stored verbatim (brackets + parens stay in the text)", () => {
    const note = minimalNote("[click here](https://example.com)");
    const bytes = seedNoteDoc(note);

    const doc = new LoroDoc();
    doc.import(bytes);

    expect(getEntryContentText(doc, 0)!.toString()).toBe(
      "[click here](https://example.com)",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: marks survive the full storage round-trip
// ---------------------------------------------------------------------------

describe("Marks survive the full storage round-trip (seed -> export -> import -> listEntries)", () => {
  it("bold + italic + link round-trip to the original markdown", () => {
    const md = "**bold** and *italic* and [x](http://y)";
    const note = minimalNote(md);

    const bytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(bytes);

    const entries = listEntries(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe(md);
  });

  it("plain text (no marks) round-trips unchanged", () => {
    const md = "# Heading\n\nSome plain text here.\n\n- item 1\n- item 2";
    const note = minimalNote(md);

    const bytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(bytes);

    const entries = listEntries(doc);
    expect(entries[0].content).toBe(md);
  });

  it("mixed block + inline round-trips correctly", () => {
    // The heading and list stay as literal text; the bold is a mark.
    const md = "# Protocol\n\n**Important:** load 20 ug total protein.";
    const note = minimalNote(md);

    const bytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(bytes);

    const entries = listEntries(doc);
    expect(entries[0].content).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// Test 4: seed byte-determinism holds WITH marks
// ---------------------------------------------------------------------------

describe("Seed byte-determinism with marks (the fork-pitfall gate, with marks)", () => {
  it("two independent seeds of the same marked note are byte-identical", () => {
    const md = "**bold** and *italic* and [x](http://y)";
    const note = minimalNote(md);

    const a = seedNoteDoc(note);
    const b = seedNoteDoc(note);

    expect(bytesEqual(a, b)).toBe(true);
  });

  it("determinism holds for a note with multiple marked entries", () => {
    const note: Note = {
      id: 2,
      title: "Multi-entry",
      description: "",
      is_running_log: true,
      is_shared: false,
      created_at: "2026-02-01T00:00:00Z",
      entries: [
        {
          id: "entry-b",
          title: "Second",
          date: "2026-02-02",
          content: "*italic only*",
          created_at: "2026-02-02T00:00:00Z",
          updated_at: "2026-02-02T00:00:00Z",
        },
        {
          id: "entry-a",
          title: "First",
          date: "2026-02-01",
          content: "**bold** and [link](http://z)",
          created_at: "2026-02-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
        },
      ],
    } as Note;

    const a = seedNoteDoc(note);
    const b = seedNoteDoc(note);

    expect(bytesEqual(a, b)).toBe(true);
  });

  it("input entry order does NOT affect bytes (canonical sort by id, with marks)", () => {
    const base: Note = {
      id: 3,
      title: "Sorted",
      description: "",
      is_running_log: false,
      is_shared: false,
      created_at: "2026-03-01T00:00:00Z",
      entries: [
        {
          id: "entry-a",
          title: "A",
          date: "2026-03-01",
          content: "**a bold**",
          created_at: "2026-03-01T00:00:00Z",
          updated_at: "2026-03-01T00:00:00Z",
        },
        {
          id: "entry-b",
          title: "B",
          date: "2026-03-02",
          content: "*italic b*",
          created_at: "2026-03-02T00:00:00Z",
          updated_at: "2026-03-02T00:00:00Z",
        },
      ],
    } as Note;

    const reversed: Note = { ...base, entries: [...base.entries].reverse() };

    const a = seedNoteDoc(base);
    const b = seedNoteDoc(reversed);

    expect(bytesEqual(a, b)).toBe(true);
  });
});
