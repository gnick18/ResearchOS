import "@/components/__tests__/prewarm-editor-chunk";
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

/**
 * CM6 ROUND-TRIP GATE (Typora editor chip 1 / T0 — the go/no-go gate).
 *
 * The whole local-first contract for the new inline editor is "the CodeMirror
 * document IS the markdown text; it is never reinterpreted." This test proves
 * that structurally: we mount a real CM6 EditorView seeded with a fixture that
 * exercises EVERY piece of our markdown dialect (see
 * MARKDOWN_EDITOR_TYPORA_DESIGN.md §0), type-then-revert through a transaction,
 * and assert `view.state.doc.toString()` comes back byte-for-byte identical.
 *
 * The dialect pieces under test:
 *   - `_underline_`            single-underscore underline (remark-underline override)
 *   - `<u>literal</u>`         literal underline HTML (the Cmd+U form)
 *   - `**bold**` / `__bold__`  both bold forms
 *   - `*italic*`               asterisk italic
 *   - `<!-- stamp:start -->`   HTML comments (allowComments:true)
 *   - raw `<img src=...>`       raw HTML via rehype-raw
 *   - a GFM table
 *   - `~~strike~~`             GFM strikethrough
 *   - a task list
 *   - a fenced code block
 *
 * This runs in jsdom (the file is .test.tsx) because CM6's EditorView needs a
 * DOM to attach to. We never render layout, so jsdom's lack of real layout is
 * irrelevant — we only read the document string back.
 *
 * If this ever fails, the inline editor must NOT ship: it would mean the editor
 * mutates the source, which breaks the "your data is clean markdown you own"
 * promise. Per the brief, a failure here is a STOP-and-report condition.
 */

// The fixture exercises every dialect piece. Authored as an array joined by
// "\n" so the exact bytes are explicit and reviewable.
const DIALECT_FIXTURE = [
  "# Heading with `inline code`",
  "",
  "A paragraph with **bold**, __bold too__, *italic*, _underline_, and",
  "a literal <u>underlined</u> span plus ~~strikethrough~~ text.",
  "",
  "<!-- stamp:start -->",
  "Stamped body line.",
  "<!-- stamp:end -->",
  "",
  '<img src="Images/figure-1.png" alt="Figure 1" width="50%">',
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

describe("InlineMarkdownEditor round-trip gate (CM6 doc is the source of truth)", () => {
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
        // markdown() is the only language extension that matters for the
        // round-trip: it tokenizes for highlighting but NEVER rewrites the doc.
        extensions: [markdown()],
      }),
      parent: host,
    });
    return view;
  }

  it("mounts the dialect fixture unchanged (document === input on mount)", () => {
    const v = mount(DIALECT_FIXTURE);
    expect(v.state.doc.toString()).toBe(DIALECT_FIXTURE);
  });

  it("survives a type-then-revert edit byte-for-byte", () => {
    const v = mount(DIALECT_FIXTURE);

    // Type some text at the very start of the document.
    const inserted = "ZZZ";
    v.dispatch({ changes: { from: 0, insert: inserted } });
    expect(v.state.doc.toString()).toBe(inserted + DIALECT_FIXTURE);

    // Revert: delete exactly what we inserted.
    v.dispatch({ changes: { from: 0, to: inserted.length, insert: "" } });

    // THE GATE: the document must be byte-for-byte identical to the input.
    expect(v.state.doc.toString()).toBe(DIALECT_FIXTURE);
  });

  it("preserves each dialect token verbatim through an interior edit", () => {
    const v = mount(DIALECT_FIXTURE);

    // Insert a marker in the middle of the paragraph, then remove it. The
    // underscore-underline, literal <u>, table pipes, HTML comment, raw <img>,
    // strike, task list, and fenced code must all be untouched bytes.
    const mid = Math.floor(DIALECT_FIXTURE.length / 2);
    v.dispatch({ changes: { from: mid, insert: "Q" } });
    v.dispatch({ changes: { from: mid, to: mid + 1, insert: "" } });

    const out = v.state.doc.toString();
    expect(out).toBe(DIALECT_FIXTURE);

    // Belt-and-suspenders: assert each load-bearing dialect substring is intact
    // (a re-serializing editor would have normalized one of these).
    expect(out).toContain("_underline_");
    expect(out).toContain("<u>underlined</u>");
    expect(out).toContain("**bold**");
    expect(out).toContain("__bold too__");
    expect(out).toContain("*italic*");
    expect(out).toContain("<!-- stamp:start -->");
    expect(out).toContain("<!-- stamp:end -->");
    expect(out).toContain('<img src="Images/figure-1.png" alt="Figure 1" width="50%">');
    expect(out).toContain("| Sample | Cq |");
    expect(out).toContain("~~strikethrough~~");
    expect(out).toContain("- [ ] prep the plate");
    expect(out).toContain("- [x] run the cycler");
    expect(out).toContain("```python");
  });
});
