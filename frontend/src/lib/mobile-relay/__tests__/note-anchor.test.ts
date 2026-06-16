import { describe, it, expect } from "vitest";
import { splitBlocks, blockAnchor } from "@/lib/mobile-relay/note-anchor";

// Laptop-side mirror of mobile/lib/note-anchor.test.ts. The two note-anchor.ts
// copies are DUPLICATED across the workspace boundary (the packages cannot
// import each other), so this suite pins the SAME contract + the SAME hex
// fingerprints the mobile node-script test pins. If either copy drifts, the
// pinned hex values fail on one side and the round-trip placement breaks.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

describe("note-anchor splitBlocks", () => {
  it("splits on blank-line boundaries, trims, and drops empties", () => {
    const doc = "# Title\n\nFirst paragraph.\n\n- a\n- b\n\n\n  \n\nLast block.\n";
    expect(splitBlocks(doc)).toEqual([
      "# Title",
      "First paragraph.",
      "- a\n- b",
      "Last block.",
    ]);
  });

  it("returns no blocks for an empty or whitespace-only doc", () => {
    expect(splitBlocks("")).toEqual([]);
    expect(splitBlocks("   \n\n   ")).toEqual([]);
  });

  it("normalizes CRLF before splitting", () => {
    expect(splitBlocks("a\r\n\r\nb")).toEqual(["a", "b"]);
  });
});

describe("note-anchor blockAnchor", () => {
  it("is deterministic for the same input", () => {
    expect(blockAnchor("First paragraph.")).toBe(blockAnchor("First paragraph."));
  });

  it("normalizes whitespace runs and case to the same anchor", () => {
    expect(blockAnchor("  First    Paragraph.  ")).toBe(blockAnchor("first paragraph."));
  });

  it("changes the anchor when the block content changes", () => {
    expect(blockAnchor("First paragraph.")).not.toBe(blockAnchor("Second paragraph."));
  });

  // Cross-package pins. These hex values are also asserted in the mobile node
  // test; a drift in either djb2 implementation fails here.
  it("matches the pinned cross-package fingerprints", () => {
    expect(blockAnchor("First paragraph.")).toBe("b7ddffb1");
    expect(blockAnchor("# Title")).toBe("dd09a9ea");
    expect(blockAnchor("# Title")).toBe(blockAnchor("#   title"));
    expect(/^[0-9a-f]+$/.test(blockAnchor("# Title"))).toBe(true);
  });
});
