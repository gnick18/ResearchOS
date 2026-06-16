import { describe, it, expect } from "vitest";
import {
  insertNoteBlockIntoMarkdown,
  NOTE_TOP_ANCHOR_INDEX,
  NOTE_END_ANCHOR_INDEX,
} from "@/lib/mobile-relay/poll";
import { blockAnchor, splitBlocks } from "@/lib/mobile-relay/note-anchor";

// The anchor-match round-trip is the load-bearing correctness property of phone
// notes P2 (a miss must be cosmetic, never a corruption). These tests pin that
// the block lands at the right boundary and never splits existing text.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

const DOC = "# Title\n\nFirst block.\n\nSecond block.\n\nThird block.";
const NOTE = "> [!phone-note] Grant\n> a phone note";

describe("insertNoteBlockIntoMarkdown anchoring", () => {
  it("inserts after the anchored block (content match)", () => {
    const anchor = blockAnchor("First block.");
    const out = insertNoteBlockIntoMarkdown(DOC, NOTE, anchor, 1);
    const blocks = splitBlocks(out);
    // The note now sits between "First block." and "Second block.".
    expect(blocks).toEqual([
      "# Title",
      "First block.",
      NOTE,
      "Second block.",
      "Third block.",
    ]);
  });

  it("inserts at the very top for the TOP sentinel", () => {
    const out = insertNoteBlockIntoMarkdown(DOC, NOTE, "", NOTE_TOP_ANCHOR_INDEX);
    expect(splitBlocks(out)[0]).toBe(NOTE);
  });

  it("appends at the very end for the END sentinel", () => {
    const out = insertNoteBlockIntoMarkdown(DOC, NOTE, "", NOTE_END_ANCHOR_INDEX);
    const blocks = splitBlocks(out);
    expect(blocks[blocks.length - 1]).toBe(NOTE);
  });

  it("makes the note the whole doc when the doc is empty", () => {
    expect(insertNoteBlockIntoMarkdown("", NOTE, "", 0).trim()).toBe(NOTE);
  });

  it("picks the match nearest the pulled index when anchors collide", () => {
    // Two identical blocks, so two matching anchors. anchorIndex disambiguates.
    const doc = "dup\n\nmiddle\n\ndup";
    const anchor = blockAnchor("dup");
    // Pulled index 2 = the second "dup"; insert after it (at the end).
    const out = insertNoteBlockIntoMarkdown(doc, NOTE, anchor, 2);
    const blocks = splitBlocks(out);
    expect(blocks).toEqual(["dup", "middle", "dup", NOTE]);
  });

  it("falls back to the nearest surviving block when the anchor is gone", () => {
    // The block the phone anchored to was edited away since the pull. The note
    // must still land close (nearest index), never corrupt, never be dropped.
    const out = insertNoteBlockIntoMarkdown(DOC, NOTE, "deadbeef", 1);
    const blocks = splitBlocks(out);
    // Nearest surviving index to 1 is block 1 ("First block."), insert after it.
    expect(blocks).toContain(NOTE);
    expect(blocks[2]).toBe(NOTE);
    // No existing block was split or lost.
    expect(blocks).toContain("# Title");
    expect(blocks).toContain("Second block.");
    expect(blocks).toContain("Third block.");
  });

  it("never splits an existing block (only whole-block boundaries)", () => {
    const anchor = blockAnchor("Second block.");
    const out = insertNoteBlockIntoMarkdown(DOC, NOTE, anchor, 2);
    // Every original block survives intact.
    for (const b of ["# Title", "First block.", "Second block.", "Third block."]) {
      expect(out).toContain(b);
    }
  });

  it("preserves the rest of the doc VERBATIM (no re-serialize)", () => {
    // A fenced code block containing a blank line, plus a multi-blank-line gap.
    // A split-then-rejoin would collapse the gap and could mangle the fence; an
    // offset splice must leave every original byte untouched.
    const doc =
      "# Title\n\n```py\nx = 1\n\ny = 2\n```\n\n\n\nTrailing prose.";
    const anchor = blockAnchor("# Title");
    const out = insertNoteBlockIntoMarkdown(doc, NOTE, anchor, 0);
    // The code fence + its internal blank line + the 3-blank-line gap survive.
    expect(out).toContain("```py\nx = 1\n\ny = 2\n```");
    expect(out).toContain("\n\n\n\nTrailing prose.");
    // The note landed right after the title, before the code fence.
    expect(out.indexOf(NOTE)).toBeGreaterThan(out.indexOf("# Title"));
    expect(out.indexOf(NOTE)).toBeLessThan(out.indexOf("```py"));
    // Removing the inserted note yields the original doc byte-for-byte.
    expect(out.replace("\n\n" + NOTE, "")).toBe(doc);
  });
});
