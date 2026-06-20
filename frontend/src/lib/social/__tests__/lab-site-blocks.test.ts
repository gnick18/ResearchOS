// Unit tests for lab-site-blocks.ts.
//
// Covers: parse/serialize round-trips, defensive handling of malformed input,
// unknown-kind dropping, two-column structure, width coercion, and the size cap.
// All tests are pure (no DB, no browser, no network).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  parseLabSiteBlocks,
  serializeLabSiteBlocks,
  parseBlockWidth,
  isDataBlockKind,
  MAX_BLOCKS_JSON_BYTES,
  type LabSiteBlock,
  type HeadingBlock,
  type TextBlock,
  type FigureBlock,
  type TwoColumnBlock,
} from "../lab-site-blocks";

// ---------------------------------------------------------------------------
// parseBlockWidth
// ---------------------------------------------------------------------------

describe("parseBlockWidth", () => {
  it("accepts inset", () => {
    expect(parseBlockWidth("inset")).toBe("inset");
  });
  it("accepts full", () => {
    expect(parseBlockWidth("full")).toBe("full");
  });
  it("accepts column", () => {
    expect(parseBlockWidth("column")).toBe("column");
  });
  it("defaults unknown strings to column", () => {
    expect(parseBlockWidth("wide")).toBe("column");
  });
  it("defaults null to column", () => {
    expect(parseBlockWidth(null)).toBe("column");
  });
  it("defaults undefined to column", () => {
    expect(parseBlockWidth(undefined)).toBe("column");
  });
});

// ---------------------------------------------------------------------------
// isDataBlockKind
// ---------------------------------------------------------------------------

describe("isDataBlockKind", () => {
  it("identifies data block kinds", () => {
    expect(isDataBlockKind("figure")).toBe(true);
    expect(isDataBlockKind("table")).toBe(true);
    expect(isDataBlockKind("dataset-explorer")).toBe(true);
    expect(isDataBlockKind("chart")).toBe(true);
  });
  it("rejects non-data kinds", () => {
    expect(isDataBlockKind("heading")).toBe(false);
    expect(isDataBlockKind("text")).toBe(false);
    expect(isDataBlockKind("image")).toBe(false);
    expect(isDataBlockKind("two-column")).toBe(false);
    expect(isDataBlockKind("unknown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseLabSiteBlocks: degenerate inputs
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: degenerate inputs", () => {
  it("returns empty for null", () => {
    expect(parseLabSiteBlocks(null)).toEqual([]);
  });
  it("returns empty for undefined", () => {
    expect(parseLabSiteBlocks(undefined)).toEqual([]);
  });
  it("returns empty for empty string", () => {
    expect(parseLabSiteBlocks("")).toEqual([]);
  });
  it("returns empty for invalid JSON string", () => {
    expect(parseLabSiteBlocks("{not json")).toEqual([]);
  });
  it("returns empty for a JSON object (not array)", () => {
    expect(parseLabSiteBlocks('{"kind":"heading"}')).toEqual([]);
  });
  it("returns empty for a JSON number", () => {
    expect(parseLabSiteBlocks("42")).toEqual([]);
  });
  it("returns empty array for an empty array", () => {
    expect(parseLabSiteBlocks("[]")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseLabSiteBlocks: heading block
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: heading block", () => {
  it("parses a heading block at level 2 (default)", () => {
    const raw = [{ id: "h1", kind: "heading", props: { text: "My Heading" } }];
    const result = parseLabSiteBlocks(JSON.stringify(raw));
    expect(result).toHaveLength(1);
    const block = result[0] as HeadingBlock;
    expect(block.kind).toBe("heading");
    expect(block.id).toBe("h1");
    expect(block.props.text).toBe("My Heading");
    expect(block.props.level).toBe(2);
  });
  it("parses heading level 1", () => {
    const raw = [{ id: "h1", kind: "heading", props: { text: "Title", level: 1 } }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as HeadingBlock;
    expect(block.props.level).toBe(1);
  });
  it("parses heading level 3", () => {
    const raw = [{ id: "h3", kind: "heading", props: { text: "Sub", level: 3 } }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as HeadingBlock;
    expect(block.props.level).toBe(3);
  });
  it("defaults level to 2 when out-of-range", () => {
    const raw = [{ id: "hx", kind: "heading", props: { text: "X", level: 5 } }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as HeadingBlock;
    expect(block.props.level).toBe(2);
  });
  it("collapses missing text to empty string", () => {
    const raw = [{ id: "h1", kind: "heading", props: {} }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as HeadingBlock;
    expect(block.props.text).toBe("");
  });
  it("collapses missing props to empty-string text + level 2", () => {
    const raw = [{ id: "h1", kind: "heading" }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as HeadingBlock;
    expect(block.props.text).toBe("");
    expect(block.props.level).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parseLabSiteBlocks: text block
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: text block", () => {
  it("parses a text block", () => {
    const raw = [{ id: "t1", kind: "text", props: { markdown: "Hello **world**" } }];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0] as TextBlock;
    expect(block.kind).toBe("text");
    expect(block.props.markdown).toBe("Hello **world**");
  });
  it("collapses missing markdown to empty string", () => {
    const raw = [{ id: "t1", kind: "text", props: {} }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as TextBlock;
    expect(block.props.markdown).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseLabSiteBlocks: image block
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: image block", () => {
  it("parses an image block with full width", () => {
    const raw = [{
      id: "img1",
      kind: "image",
      props: { src: "https://example.com/img.png", alt: "Alt", caption: "Cap", width: "full" },
    }];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0];
    expect(block.kind).toBe("image");
    if (block.kind === "image") {
      expect(block.props.src).toBe("https://example.com/img.png");
      expect(block.props.width).toBe("full");
    }
  });
});

// ---------------------------------------------------------------------------
// parseLabSiteBlocks: data blocks (figure, table, dataset-explorer, chart)
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: data blocks", () => {
  const kinds = ["figure", "table", "dataset-explorer", "chart"] as const;
  for (const kind of kinds) {
    it(`parses a ${kind} block with inset width`, () => {
      const raw = [{
        id: "d1",
        kind,
        props: { sourceId: "abc-123", caption: "Fig 1", width: "inset" },
      }];
      const result = parseLabSiteBlocks(raw);
      expect(result).toHaveLength(1);
      const block = result[0] as FigureBlock;
      expect(block.kind).toBe(kind);
      expect(block.props.sourceId).toBe("abc-123");
      expect(block.props.caption).toBe("Fig 1");
      expect(block.props.width).toBe("inset");
    });
    it(`${kind}: defaults missing sourceId to empty string`, () => {
      const raw = [{ id: "d1", kind, props: { caption: "Cap" } }];
      const result = parseLabSiteBlocks(raw);
      const block = result[0] as FigureBlock;
      expect(block.props.sourceId).toBe("");
    });
    it(`${kind}: defaults missing width to column`, () => {
      const raw = [{ id: "d1", kind, props: { sourceId: "x" } }];
      const result = parseLabSiteBlocks(raw);
      const block = result[0] as FigureBlock;
      expect(block.props.width).toBe("column");
    });
  }
});

// ---------------------------------------------------------------------------
// parseLabSiteBlocks: unknown kind dropping
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: unknown kind dropping", () => {
  it("drops unknown block kinds silently", () => {
    const raw = [
      { id: "u1", kind: "video", props: {} },
      { id: "h1", kind: "heading", props: { text: "Kept" } },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("heading");
  });
  it("drops non-object array entries", () => {
    const raw = [
      null,
      42,
      "string",
      { id: "t1", kind: "text", props: { markdown: "OK" } },
    ];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("text");
  });
  it("generates a fallback id when id is missing", () => {
    const raw = [{ kind: "text", props: { markdown: "No id" } }];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0];
    // The fallback id is a generated string, not empty.
    expect(typeof block.id).toBe("string");
    expect(block.id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseLabSiteBlocks: two-column block
// ---------------------------------------------------------------------------

describe("parseLabSiteBlocks: two-column block", () => {
  it("parses a two-column block with left and right leaves", () => {
    const raw = [{
      id: "tc1",
      kind: "two-column",
      props: {
        left: [{ id: "l1", kind: "text", props: { markdown: "Left" } }],
        right: [{ id: "r1", kind: "figure", props: { sourceId: "fig1", caption: "", width: "column" } }],
      },
    }];
    const result = parseLabSiteBlocks(raw);
    expect(result).toHaveLength(1);
    const block = result[0] as TwoColumnBlock;
    expect(block.kind).toBe("two-column");
    expect(block.props.left).toHaveLength(1);
    expect(block.props.left[0].kind).toBe("text");
    expect(block.props.right).toHaveLength(1);
    expect(block.props.right[0].kind).toBe("figure");
  });
  it("drops unknown leaf kinds inside two-column", () => {
    const raw = [{
      id: "tc1",
      kind: "two-column",
      props: {
        left: [
          { id: "u1", kind: "video", props: {} },
          { id: "h1", kind: "heading", props: { text: "OK" } },
        ],
        right: [],
      },
    }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as TwoColumnBlock;
    expect(block.props.left).toHaveLength(1);
    expect(block.props.left[0].kind).toBe("heading");
  });
  it("treats missing left/right as empty arrays", () => {
    const raw = [{ id: "tc1", kind: "two-column", props: {} }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as TwoColumnBlock;
    expect(block.props.left).toEqual([]);
    expect(block.props.right).toEqual([]);
  });
  it("does not allow two-column inside two-column", () => {
    // A nested two-column in a leaf slot is an unknown leaf kind, so it is
    // dropped (only leaf block kinds are allowed in left/right).
    const raw = [{
      id: "tc1",
      kind: "two-column",
      props: {
        left: [{ id: "tc2", kind: "two-column", props: { left: [], right: [] } }],
        right: [],
      },
    }];
    const result = parseLabSiteBlocks(raw);
    const block = result[0] as TwoColumnBlock;
    // The nested two-column is an unknown leaf kind and is dropped.
    expect(block.props.left).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialize then parse
// ---------------------------------------------------------------------------

describe("round-trip: serialize then parse", () => {
  it("round-trips a mixed block array", () => {
    const blocks: LabSiteBlock[] = [
      { id: "h1", kind: "heading", props: { text: "Title", level: 1 } },
      { id: "t1", kind: "text", props: { markdown: "Some text." } },
      { id: "f1", kind: "figure", props: { sourceId: "fig-abc", caption: "Figure 1", width: "full" } },
      {
        id: "tc1",
        kind: "two-column",
        props: {
          left: [{ id: "l1", kind: "text", props: { markdown: "Left" } }],
          right: [{ id: "r1", kind: "chart", props: { sourceId: "ch1", caption: "", width: "inset" } }],
        },
      },
    ];
    const json = serializeLabSiteBlocks(blocks);
    expect(typeof json).toBe("string");
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual(blocks);
  });
  it("round-trips an empty array", () => {
    const json = serializeLabSiteBlocks([]);
    expect(json).toBe("[]");
    const reparsed = parseLabSiteBlocks(json!);
    expect(reparsed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// serializeLabSiteBlocks: size cap
// ---------------------------------------------------------------------------

describe("serializeLabSiteBlocks: size cap", () => {
  it("returns null when the serialized form exceeds MAX_BLOCKS_JSON_BYTES", () => {
    // Build a block whose markdown body alone exceeds the cap.
    const giant: LabSiteBlock = {
      id: "t1",
      kind: "text",
      props: { markdown: "x".repeat(MAX_BLOCKS_JSON_BYTES + 1) },
    };
    const result = serializeLabSiteBlocks([giant]);
    expect(result).toBeNull();
  });
  it("returns a string for a payload at or below the cap", () => {
    const block: LabSiteBlock = {
      id: "h1",
      kind: "heading",
      props: { text: "Small", level: 2 },
    };
    const result = serializeLabSiteBlocks([block]);
    expect(typeof result).toBe("string");
  });
});
