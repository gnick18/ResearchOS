import { beforeEach, describe, expect, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import type { SyntaxNodeRef } from "@lezer/common";
import {
  forgivingEmphasis,
  __resetBuiltinEmphasisCacheForTest,
} from "./forgiving-emphasis";

/**
 * forgiving-emphasis tests (Typora editor bug A + bug B).
 *
 * We parse with the SAME parser the editor uses: the GFM markdownLanguage base
 * extended with the forgivingEmphasis config (mirroring
 * `markdown({ base: markdownLanguage, extensions: [forgivingEmphasis] })` in
 * InlineMarkdownEditor). We then walk the lezer tree and assert which container
 * nodes (StrongEmphasis / Emphasis) appear and over what ranges.
 *
 * Bug A: a single space adjacent to / inside a `**` or `*` run still renders
 * emphasis. Bug B: an UNMATCHED `**` never bleeds across a paragraph boundary
 * (it stays literal text), even with the forgiving relaxation active.
 */

// markdownLanguage.parser is a MarkdownParser at runtime; the lang-markdown types
// widen it to the common Parser, so cast to reach .configure.
const parser = (markdownLanguage.parser as unknown as MarkdownParser).configure(
  forgivingEmphasis,
);

/** Collect every node of the given name as [from, to] pairs. */
function nodesNamed(src: string, name: string): Array<[number, number]> {
  const tree = parser.parse(src);
  const out: Array<[number, number]> = [];
  tree.iterate({
    enter: (n: SyntaxNodeRef) => {
      if (n.name === name) out.push([n.from, n.to]);
    },
  });
  return out;
}

function hasNode(src: string, name: string): boolean {
  return nodesNamed(src, name).length > 0;
}

beforeEach(() => {
  // Start each case from a cold harvested-singleton cache, so the tests prove the
  // forgiving path works WITHOUT any prior well-formed emphasis priming it (the
  // standard-flanking OPEN of a `**bold **` run harvests the singleton in time for
  // its own forgiving CLOSE).
  __resetBuiltinEmphasisCacheForTest();
});

describe("bug A: forgiving emphasis with an adjacent single space", () => {
  it("renders bold for a trailing space before the close (**bold **)", () => {
    const src = "**there is bold **";
    expect(hasNode(src, "StrongEmphasis")).toBe(true);
  });

  it("renders italic for a trailing space before a single-* close (*it *)", () => {
    const src = "this is *italic * here";
    expect(hasNode(src, "Emphasis")).toBe(true);
  });

  it("still renders a perfectly-formed bold run unchanged (**bold**)", () => {
    const src = "**bold**";
    const strong = nodesNamed(src, "StrongEmphasis");
    expect(strong).toContainEqual([0, src.length]);
  });

  it("keeps snake_case plain (underscore word-boundary guard holds)", () => {
    const src = "a snake_case_word b";
    expect(hasNode(src, "Emphasis")).toBe(false);
    expect(hasNode(src, "StrongEmphasis")).toBe(false);
  });

  it("does not invent emphasis from a delimiter floating between spaces", () => {
    // " ** " has whitespace on BOTH sides of the run, nothing to bold.
    const src = "a ** b";
    expect(hasNode(src, "StrongEmphasis")).toBe(false);
  });
});

describe("bug B: an unmatched ** must not bleed across blocks", () => {
  it("does not bold across a blank-line paragraph break", () => {
    const src = "**unclosed\n\nsecond paragraph";
    expect(hasNode(src, "StrongEmphasis")).toBe(false);
    expect(hasNode(src, "Emphasis")).toBe(false);
  });

  it("does not bold the preceding paragraph when a list marker follows", () => {
    // The reported trigger: typing a `-` list item after a stray `**`.
    const src = "first **para text\n- item";
    expect(hasNode(src, "StrongEmphasis")).toBe(false);
    // The list still parses normally.
    expect(hasNode(src, "BulletList")).toBe(true);
  });

  it("keeps a stray ** self-contained within its own paragraph", () => {
    const src = "before **stray after";
    // No closing delimiter in the same inline section, so no emphasis node.
    expect(hasNode(src, "StrongEmphasis")).toBe(false);
  });
});
