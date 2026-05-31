import { describe, expect, it } from "vitest";
import {
  selectionTouchesNode,
  type SelectionLike,
} from "./selection-touches";

/**
 * Unit tests for the reveal predicate (Typora editor chip 2a). The closed
 * interval is the load-bearing detail: a bare caret at EITHER boundary must
 * reveal the token, and nested containers must each get an independent answer.
 */

/** Build a caret (zero-width range) selection at offset n. */
function caret(n: number): SelectionLike {
  return { ranges: [{ from: n, to: n }] };
}

/** Build a non-empty selection. */
function span(from: number, to: number): SelectionLike {
  return { ranges: [{ from, to }] };
}

describe("selectionTouchesNode (closed-interval reveal predicate)", () => {
  // Node spanning [10, 18) for a token like **bold** at offsets 10..18.
  const from = 10;
  const to = 18;

  it("reveals when a caret sits strictly inside the node", () => {
    expect(selectionTouchesNode(caret(14), from, to)).toBe(true);
  });

  it("reveals when a caret sits exactly at the FROM boundary (closed interval)", () => {
    expect(selectionTouchesNode(caret(from), from, to)).toBe(true);
  });

  it("reveals when a caret sits exactly at the TO boundary (closed interval)", () => {
    expect(selectionTouchesNode(caret(to), from, to)).toBe(true);
  });

  it("does NOT reveal when the caret is one before FROM", () => {
    expect(selectionTouchesNode(caret(from - 1), from, to)).toBe(false);
  });

  it("does NOT reveal when the caret is one after TO", () => {
    expect(selectionTouchesNode(caret(to + 1), from, to)).toBe(false);
  });

  it("reveals when a selection span overlaps the node at all", () => {
    expect(selectionTouchesNode(span(5, 11), from, to)).toBe(true);
    expect(selectionTouchesNode(span(17, 25), from, to)).toBe(true);
    expect(selectionTouchesNode(span(0, 100), from, to)).toBe(true);
  });

  it("does NOT reveal a selection span entirely before or after the node", () => {
    expect(selectionTouchesNode(span(0, 9), from, to)).toBe(false);
    expect(selectionTouchesNode(span(19, 25), from, to)).toBe(false);
  });

  it("reveals if ANY range of a multi-cursor selection touches", () => {
    const multi: SelectionLike = {
      ranges: [
        { from: 0, to: 0 }, // far before, no touch
        { from: 14, to: 14 }, // inside, touch
      ],
    };
    expect(selectionTouchesNode(multi, from, to)).toBe(true);
  });

  it("handles nesting: each container gets an independent answer for the same caret", () => {
    // Outer Link [0, 30); inner StrongEmphasis [10, 18). A caret at 14 touches
    // BOTH; a caret at 2 touches only the outer; a caret at 25 touches only the
    // outer. The predicate is per-node, so the caller asks once per container.
    const outerFrom = 0;
    const outerTo = 30;
    const innerFrom = 10;
    const innerTo = 18;

    const inBold = caret(14);
    expect(selectionTouchesNode(inBold, outerFrom, outerTo)).toBe(true);
    expect(selectionTouchesNode(inBold, innerFrom, innerTo)).toBe(true);

    const inLinkOnly = caret(2);
    expect(selectionTouchesNode(inLinkOnly, outerFrom, outerTo)).toBe(true);
    expect(selectionTouchesNode(inLinkOnly, innerFrom, innerTo)).toBe(false);

    const afterBoldStillLink = caret(25);
    expect(selectionTouchesNode(afterBoldStillLink, outerFrom, outerTo)).toBe(
      true,
    );
    expect(selectionTouchesNode(afterBoldStillLink, innerFrom, innerTo)).toBe(
      false,
    );
  });
});
