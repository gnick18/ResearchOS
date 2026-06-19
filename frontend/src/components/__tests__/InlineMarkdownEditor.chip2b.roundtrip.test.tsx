import "@/components/__tests__/prewarm-editor-chunk";
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";

import { inlineRevealExtension } from "@/lib/markdown/cm-inline-reveal/inline-reveal";

/**
 * CM6 CHIP 2b ROUND-TRIP GATE (block widgets + image widget + keymap active).
 *
 * Chip 2a proved the inline-reveal layer is byte-exact. Chip 2b adds block
 * widgets (Table / FencedCode), the inline image widget, and the hybrid-parity
 * markdown keymap. The widgets are still VIEW-ONLY (decorations carrying a
 * widget, never a doc mutation); the keymap dispatches doc changes ONLY on a
 * user keypress, never as a side effect of a caret move or a rebuild.
 *
 * So with the FULL chip 2b extension mounted, the document must STILL come back
 * byte-for-byte identical when the only thing happening is caret movement and
 * inert edits. This is the go/no-go: if the widgets or the keymap registration
 * mutate the source on their own, this fails and chip 2b must NOT ship.
 *
 * inlineRevealExtension now includes the keymap, so mounting it here exercises
 * the exact extension the editor spreads in.
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
  "![inline figure](Images/figure-2.png)",
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

describe("InlineMarkdownEditor chip 2b round-trip gate (widgets + keymap are byte-exact)", () => {
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
          markdown({ base: markdownLanguage }),
          // The FULL chip 2b extension: reveal plugin + block/image widgets +
          // the hybrid-parity keymap.
          inlineRevealExtension,
        ],
      }),
      parent: host,
    });
    forceParsing(view, initialDoc.length);
    return view;
  }

  it("mounts the dialect fixture unchanged with widgets + keymap active", () => {
    const v = mount(DIALECT_FIXTURE);
    expect(v.state.doc.toString()).toBe(DIALECT_FIXTURE);
  });

  it("survives the caret crossing EVERY offset byte-for-byte (widgets collapse + reveal, no mutation)", () => {
    const v = mount(DIALECT_FIXTURE);
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

  it("keeps every load-bearing dialect substring intact after a caret sweep + edit revert", () => {
    const v = mount(DIALECT_FIXTURE);

    // Park inside the table, then inside the fenced block, then inside the image
    // (each toggles a widget on/off), then type-revert in the paragraph.
    const inTable = DIALECT_FIXTURE.indexOf("ctrl");
    const inFence = DIALECT_FIXTURE.indexOf("def amplify");
    const inImage = DIALECT_FIXTURE.indexOf("figure-2");
    for (const pos of [inTable, inFence, inImage, 0]) {
      v.dispatch({ selection: EditorSelection.cursor(pos) });
      expect(v.state.doc.toString()).toBe(DIALECT_FIXTURE);
    }

    const mid = Math.floor(DIALECT_FIXTURE.length / 2);
    v.dispatch({ changes: { from: mid, insert: "Q" } });
    v.dispatch({ changes: { from: mid, to: mid + 1, insert: "" } });

    const out = v.state.doc.toString();
    expect(out).toBe(DIALECT_FIXTURE);
    expect(out).toContain("_underline_");
    expect(out).toContain("<u>underlined</u>");
    expect(out).toContain("**bold**");
    expect(out).toContain("__bold too__");
    expect(out).toContain("*italic*");
    expect(out).toContain("<!-- stamp:start -->");
    expect(out).toContain("<!-- stamp:end -->");
    expect(out).toContain('<img src="Images/figure-1.png" alt="Figure 1" width="50%">');
    expect(out).toContain("![inline figure](Images/figure-2.png)");
    expect(out).toContain("[a link](https://example.com)");
    expect(out).toContain("> a blockquote line");
    expect(out).toContain("| Sample | Cq |");
    expect(out).toContain("| ctrl | 22.4 |");
    expect(out).toContain("~~strikethrough~~");
    expect(out).toContain("- [ ] prep the plate");
    expect(out).toContain("- [x] run the cycler");
    expect(out).toContain("```python");
    expect(out).toContain("    return x * 2");
  });
});
