import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks } from "./markdown-block-parser";

/**
 * Parser semantics — hybrid CommonMark paragraphs R2 (2026-05-26).
 *
 * Before the R2 rewrite the parser split on every newline. Typing
 * `test\n\n\ntest 2` produced three editable chunks instead of two
 * paragraphs separated by blank space. This file pins the
 * CommonMark-aligned behavior: only BLANK LINES create paragraph
 * boundaries; single `\n`'s inside non-blank text runs are soft
 * breaks within ONE paragraph; multiple consecutive blank lines
 * collapse to a single separator (no empty blocks emitted between
 * paragraphs).
 *
 * Non-paragraph blocks (heading / fence / blockquote / list / table /
 * thematic break / HTML) are tested for "still intact" — the rewrite
 * preserved their grouping behavior.
 */

describe("parseMarkdownBlocks (R2 CommonMark paragraph rules)", () => {
  describe("paragraph grouping", () => {
    it("groups two paragraphs separated by ONE blank line into 2 blocks", () => {
      // Canonical CommonMark: `\n\n` is the paragraph separator.
      const blocks = parseMarkdownBlocks("test\n\ntest 2");
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("paragraph");
      expect(blocks[0].content).toBe("test");
      expect(blocks[1].type).toBe("paragraph");
      expect(blocks[1].content).toBe("test 2");
    });

    it("collapses MANY blank lines between paragraphs into a single separator (still 2 blocks)", () => {
      // R2 contract: don't emit empty blocks between paragraphs.
      // Prior to the rewrite this gave 3+ blocks (one of them an empty
      // `blankLine` block); now it must be exactly 2.
      const blocks = parseMarkdownBlocks("test\n\n\n\n\ntest 2");
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("paragraph");
      expect(blocks[0].content).toBe("test");
      expect(blocks[1].type).toBe("paragraph");
      expect(blocks[1].content).toBe("test 2");
    });

    it("treats single \\n inside non-blank text as a soft break (one 3-line paragraph)", () => {
      // CommonMark: a single newline between two non-blank lines is a
      // soft break inside the same paragraph. The R2 rewrite preserves
      // this — the prior parser also did, but accidentally; pin it.
      const blocks = parseMarkdownBlocks("test\nline 2\nline 3");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("paragraph");
      expect(blocks[0].content).toBe("test\nline 2\nline 3");
    });

    it("emits NO blocks for an empty document", () => {
      expect(parseMarkdownBlocks("")).toEqual([]);
    });

    it("emits a single trailing blankLine for a document that is entirely whitespace", () => {
      // Whole-document blank: the editor's "+ Add paragraph" affordance
      // anchors on this block. Without it the empty document has no
      // edit target.
      const blocks = parseMarkdownBlocks("\n\n\n");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("blankLine");
    });

    it("emits a trailing blankLine when the document ends with 2+ blank lines after a paragraph", () => {
      // `test\n\n\n` = `test` + 2 trailing blank lines in the lines
      // array. We emit a trailing blankLine block as the "+ Add
      // paragraph" affordance target.
      const blocks = parseMarkdownBlocks("test\n\n\n");
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("paragraph");
      expect(blocks[1].type).toBe("blankLine");
    });

    it("does NOT emit a trailing blankLine for a paragraph followed by a single newline", () => {
      // `test\n` has just one trailing "" line in the split — that's
      // the file-ending newline artifact, not user-intended blank
      // space. Don't litter the editor with a spurious empty block.
      const blocks = parseMarkdownBlocks("test\n");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("paragraph");
      expect(blocks[0].content).toBe("test");
    });
  });

  describe("non-paragraph blocks remain intact", () => {
    it("treats ATX heading as its own block, separate from the following paragraph", () => {
      const blocks = parseMarkdownBlocks("# heading\n\ntext");
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("heading");
      expect(blocks[0].content).toBe("# heading");
      expect(blocks[1].type).toBe("paragraph");
      expect(blocks[1].content).toBe("text");
    });

    it("treats an ATX heading as its own block even without a blank line before the next text", () => {
      // CommonMark: a `#` line interrupts a paragraph — the heading
      // signature is enough on its own, no separator required.
      const blocks = parseMarkdownBlocks("# heading\ntext");
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("heading");
      expect(blocks[1].type).toBe("paragraph");
      expect(blocks[1].content).toBe("text");
    });

    it("groups a fenced code block as ONE block including all interior newlines", () => {
      const src = "```js\nconst x = 1;\nconst y = 2;\n```";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("codeBlock");
      expect(blocks[0].content).toBe(src);
      expect(blocks[0].meta?.language).toBe("js");
    });

    it("preserves a blockquote as ONE block across multiple `>` lines", () => {
      const src = "> first\n> second\n> third";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("blockquote");
      expect(blocks[0].content).toBe(src);
    });

    it("preserves a bullet list as ONE block across multiple `-` items", () => {
      const src = "- one\n- two\n- three";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("list");
      expect(blocks[0].meta?.ordered).toBe(false);
    });

    it("preserves an ordered list as ONE block across multiple `N.` items", () => {
      const src = "1. one\n2. two\n3. three";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("list");
      expect(blocks[0].meta?.ordered).toBe(true);
    });

    it("emits a thematic break (`---`) as its own block", () => {
      const blocks = parseMarkdownBlocks("text\n\n---\n\nmore");
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe("paragraph");
      expect(blocks[1].type).toBe("thematicBreak");
      expect(blocks[2].type).toBe("paragraph");
    });

    it("groups a GFM table (header + delimiter + body) as ONE block", () => {
      const src = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("table");
    });
  });

  describe("mixed documents (regression scenarios)", () => {
    it("handles paragraph + heading + paragraph without spurious blank-line blocks", () => {
      // Mixed real-world doc shape. No `blankLine` blocks between
      // content blocks under the R2 rules.
      const src = "First paragraph.\n\n# Heading\n\nSecond paragraph.";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(3);
      expect(blocks.map((b) => b.type)).toEqual([
        "paragraph",
        "heading",
        "paragraph",
      ]);
    });

    it("handles a paragraph with embedded soft breaks followed by a heading", () => {
      // The 3-line paragraph (soft breaks) stays ONE block; the heading
      // is a separate block by signature.
      const src = "line a\nline b\nline c\n\n# After";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("paragraph");
      expect(blocks[0].content).toBe("line a\nline b\nline c");
      expect(blocks[1].type).toBe("heading");
    });

    it("handles consecutive blank-line runs of varying lengths between paragraphs", () => {
      // Each blank-line run (1 line, 2 lines, 5 lines) collapses to a
      // single separator. Final block count is 4 paragraphs, zero
      // blankLine blocks between them.
      const src = "a\n\nb\n\n\nc\n\n\n\n\n\nd";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(4);
      expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
      expect(blocks.map((b) => b.content)).toEqual(["a", "b", "c", "d"]);
    });
  });

  describe("offset math", () => {
    it("computes correct startOffset/endOffset for paragraphs separated by blank lines", () => {
      // Splice safety: HybridMarkdownEditor relies on
      // startOffset/endOffset to update individual blocks within the
      // full document string. The R2 rewrite must not silently
      // shift offsets when blank-line runs aren't emitted as blocks.
      const src = "abc\n\ndef";
      const blocks = parseMarkdownBlocks(src);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].startOffset).toBe(0);
      expect(blocks[0].endOffset).toBe(3); // "abc"
      expect(blocks[1].startOffset).toBe(5); // "abc\n\n" is 5 chars
      expect(blocks[1].endOffset).toBe(8); // "def"
    });
  });
});
