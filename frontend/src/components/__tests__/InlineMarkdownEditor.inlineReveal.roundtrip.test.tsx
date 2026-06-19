import "@/components/__tests__/prewarm-editor-chunk";
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";

import { inlineRevealExtension } from "@/lib/markdown/cm-inline-reveal/inline-reveal";

/**
 * CM6 INLINE-REVEAL ROUND-TRIP GATE (Typora editor chip 2a, the go/no-go).
 *
 * Chip 1 proved the bare CM6 document round-trips. Chip 2a adds the caret-aware
 * inline-reveal layer (marker hide/reveal + atomicRanges + theme). That layer is
 * VIEW-ONLY: it never dispatches a doc-changing transaction, so the document
 * must STILL come back byte-for-byte identical no matter where the caret sits.
 *
 * This gate mounts a real EditorView WITH the inline-reveal extension, then:
 *   1. asserts the dialect fixture mounts unchanged,
 *   2. walks the caret across EVERY token (one selection change per offset of a
 *      hand-picked set that lands inside and at the boundary of each token),
 *      asserting the document is unchanged after each move,
 *   3. types-then-reverts and asserts byte-for-byte equality,
 *   4. spot-checks each load-bearing dialect substring survives.
 *
 * If this fails, chip 2a must NOT ship: it would mean the reveal layer mutates
 * the source, breaking the local-first "your data is clean markdown" promise.
 * Per the brief this is a STOP-and-report condition.
 */

const DIALECT_FIXTURE = [
  "# Heading with `inline code`",
  "",
  "A paragraph with **bold**, __bold too__, *italic*, _underline_, and",
  "a literal <u>underlined</u> span plus ~~strikethrough~~ text.",
  "",
  "> a blockquote line",
  "",
  "<!-- stamp:start -->",
  "Stamped body line.",
  "<!-- stamp:end -->",
  "",
  '<img src="Images/figure-1.png" alt="Figure 1" width="50%">',
  "",
  "[a link](https://example.com)",
  "",
  "| Sample | Cq |",
  "| --- | --- |",
  "| ctrl | 22.4 |",
  "| test | 19.8 |",
  "",
  "- [ ] prep the plate",
  "- [x] run the cycler",
  "",
  "```python",
  "def amplify(x):",
  "    return x * 2",
  "```",
  "",
].join("\n");

describe("InlineMarkdownEditor inline-reveal round-trip gate (view-only layer is byte-exact)", () => {
  let host: HTMLDivElement | null = null;
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    host?.remove();
    host = null;
  });

  function mount(initialDoc: string): EditorView {
    host = document.createElement("div");
    document.body.appendChild(host);
    view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          // GFM base so Strikethrough / Table nodes parse, matching the editor.
          markdown({ base: markdownLanguage }),
          // The layer under test.
          inlineRevealExtension,
        ],
      }),
      parent: host,
    });
    // Force a complete parse so the reveal walk runs over the whole fixture.
    forceParsing(view, initialDoc.length);
    return view;
  }

  it("mounts the dialect fixture unchanged (document === input on mount)", () => {
    const v = mount(DIALECT_FIXTURE);
    expect(v.state.doc.toString()).toBe(DIALECT_FIXTURE);
  });

  it("survives the caret crossing EVERY token offset byte-for-byte", () => {
    const v = mount(DIALECT_FIXTURE);

    // Walk the caret across EVERY offset in the document (0..length). Each move
    // dispatches a selectionSet, which rebuilds the reveal decorations; none may
    // touch the document. This is the strongest possible "across every token"
    // assertion: it lands inside, at the boundary of, and between every token.
    for (let pos = 0; pos <= DIALECT_FIXTURE.length; pos++) {
      v.dispatch({ selection: EditorSelection.cursor(pos) });
      expect(v.state.doc.toString()).toBe(DIALECT_FIXTURE);
    }
  });

  it("survives a type-then-revert edit byte-for-byte", () => {
    const v = mount(DIALECT_FIXTURE);

    const inserted = "ZZZ";
    v.dispatch({ changes: { from: 0, insert: inserted } });
    expect(v.state.doc.toString()).toBe(inserted + DIALECT_FIXTURE);

    v.dispatch({ changes: { from: 0, to: inserted.length, insert: "" } });
    expect(v.state.doc.toString()).toBe(DIALECT_FIXTURE);
  });

  it("survives an interior type-then-revert with the caret parked inside a token", () => {
    const v = mount(DIALECT_FIXTURE);

    // Park the caret inside the bold token so its markers are revealed, then
    // type and revert in the middle of the paragraph.
    const boldPos = DIALECT_FIXTURE.indexOf("**bold**") + 3;
    v.dispatch({ selection: EditorSelection.cursor(boldPos) });

    const mid = Math.floor(DIALECT_FIXTURE.length / 2);
    v.dispatch({ changes: { from: mid, insert: "Q" } });
    v.dispatch({ changes: { from: mid, to: mid + 1, insert: "" } });

    const out = v.state.doc.toString();
    expect(out).toBe(DIALECT_FIXTURE);

    // Each load-bearing dialect substring must be intact (a re-serializing
    // editor would have normalized one of these).
    expect(out).toContain("_underline_");
    expect(out).toContain("<u>underlined</u>");
    expect(out).toContain("**bold**");
    expect(out).toContain("__bold too__");
    expect(out).toContain("*italic*");
    expect(out).toContain("<!-- stamp:start -->");
    expect(out).toContain("<!-- stamp:end -->");
    expect(out).toContain('<img src="Images/figure-1.png" alt="Figure 1" width="50%">');
    expect(out).toContain("[a link](https://example.com)");
    expect(out).toContain("> a blockquote line");
    expect(out).toContain("| Sample | Cq |");
    expect(out).toContain("~~strikethrough~~");
    expect(out).toContain("- [ ] prep the plate");
    expect(out).toContain("- [x] run the cycler");
    expect(out).toContain("```python");
  });
});
