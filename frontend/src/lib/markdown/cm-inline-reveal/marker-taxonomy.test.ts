import { describe, expect, it } from "vitest";
import {
  CONTAINER_NODE_NAMES,
  MARKER_NODE_NAMES,
  contentClassFor,
  emphasisContentClass,
  isContainerNode,
  isMarkerNode,
} from "./marker-taxonomy";

/**
 * Unit tests for the marker-node taxonomy (Typora editor chip 2a). These pin the
 * exact @lezer/markdown node names we depend on and the underscore-vs-asterisk
 * Emphasis disambiguator (single-underscore => underline, per remark-underline).
 */

describe("marker-taxonomy node sets", () => {
  it("classifies the six marker node names as markers, not containers", () => {
    for (const name of MARKER_NODE_NAMES) {
      expect(isMarkerNode(name)).toBe(true);
      expect(isContainerNode(name)).toBe(false);
    }
  });

  it("classifies the container node names as containers, not markers", () => {
    for (const name of CONTAINER_NODE_NAMES) {
      expect(isContainerNode(name)).toBe(true);
      expect(isMarkerNode(name)).toBe(false);
    }
  });

  it("includes the marker names the design spec calls out", () => {
    expect(MARKER_NODE_NAMES).toContain("EmphasisMark");
    expect(MARKER_NODE_NAMES).toContain("HeaderMark");
    expect(MARKER_NODE_NAMES).toContain("LinkMark");
    expect(MARKER_NODE_NAMES).toContain("CodeMark");
    expect(MARKER_NODE_NAMES).toContain("QuoteMark");
    expect(MARKER_NODE_NAMES).toContain("StrikethroughMark");
  });

  it("treats unknown node names as neither marker nor container", () => {
    expect(isMarkerNode("Paragraph")).toBe(false);
    expect(isContainerNode("Paragraph")).toBe(false);
    expect(isMarkerNode("Document")).toBe(false);
    expect(isContainerNode("Document")).toBe(false);
  });

  it("does NOT treat Table / FencedCode as inline-reveal containers (chip 2a scope)", () => {
    // These get block widgets in the follow-up chip; here they are plain source.
    expect(isContainerNode("Table")).toBe(false);
    expect(isContainerNode("FencedCode")).toBe(false);
  });
});

describe("contentClassFor", () => {
  it("maps each container to its content class", () => {
    expect(contentClassFor("StrongEmphasis")).toBe("cm-strong");
    expect(contentClassFor("Emphasis")).toBe("cm-em"); // asterisk default
    expect(contentClassFor("Strikethrough")).toBe("cm-strike");
    expect(contentClassFor("InlineCode")).toBe("cm-inline-code");
    expect(contentClassFor("Link")).toBe("cm-link");
    expect(contentClassFor("Image")).toBe("cm-link");
    expect(contentClassFor("Blockquote")).toBe("cm-quote");
    expect(contentClassFor("ATXHeading1")).toBe("cm-h1");
    expect(contentClassFor("ATXHeading6")).toBe("cm-h6");
  });

  it("returns null for non-containers", () => {
    expect(contentClassFor("EmphasisMark")).toBeNull();
    expect(contentClassFor("Paragraph")).toBeNull();
  });
});

describe("emphasisContentClass (underscore-vs-asterisk disambiguator)", () => {
  it("underscore emphasis renders as underline", () => {
    expect(emphasisContentClass("_")).toBe("cm-underline");
  });

  it("asterisk emphasis renders as italic", () => {
    expect(emphasisContentClass("*")).toBe("cm-em");
  });

  it("any non-underscore delimiter defaults to italic", () => {
    expect(emphasisContentClass("x")).toBe("cm-em");
  });
});
