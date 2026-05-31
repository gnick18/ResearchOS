import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { StateCommand } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

import {
  blockquoteCommand,
  boldCommand,
  fencedCodeCommand,
  headingCommandFor,
  italicCommand,
  linkCommand,
  markdownKeyBindings,
  strikethroughCommand,
  underlineCommand,
} from "./markdown-keymap";

/**
 * Markdown keymap tests (Typora editor chip 2b). The keymap is the ONLY part of
 * the inline-reveal arc that dispatches a doc change, and only on a user
 * keypress. We invoke each bound StateCommand directly ({ state, dispatch })
 * against a real EditorView and assert doc.toString() + the resulting selection.
 * Driving the command directly (rather than simulating a keydown, which is
 * brittle under jsdom) is the canonical way to unit-test a CM6 command and is
 * exactly what the keymap binding calls.
 *
 * Insert-wrap parity (the hybrid-editor contract): a non-empty selection is
 * wrapped and stays selected; a bare caret inserts the empty pair with the caret
 * between the delimiters.
 */

let host: HTMLDivElement | null = null;
let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  host?.remove();
  host = null;
});

function mount(doc: string, sel: { anchor: number; head: number }): EditorView {
  host = document.createElement("div");
  document.body.appendChild(host);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(sel.anchor, sel.head),
      extensions: [markdown({ base: markdownLanguage })],
    }),
    parent: host,
  });
  return view;
}

/** Run a StateCommand against the view, returning its handled boolean. */
function run(v: EditorView, cmd: StateCommand): boolean {
  return cmd({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
}

describe("wrap commands (bold / italic / underline / strike)", () => {
  it("bold wraps a selection with ** .. ** and keeps it selected", () => {
    const v = mount("pick this word", { anchor: 5, head: 9 }); // "this"
    expect(run(v, boldCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("pick **this** word");
    expect(
      v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to),
    ).toBe("this");
  });

  it("bold on a bare caret inserts **** with the caret between the delimiters", () => {
    const v = mount("ab", { anchor: 1, head: 1 });
    expect(run(v, boldCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("a****b");
    expect(v.state.selection.main.empty).toBe(true);
    expect(v.state.selection.main.head).toBe(3);
  });

  it("italic wraps with single * .. *", () => {
    const v = mount("x word y", { anchor: 2, head: 6 });
    expect(run(v, italicCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("x *word* y");
  });

  it("underline wraps with the LITERAL <u> .. </u> (not the underscore form)", () => {
    const v = mount("x word y", { anchor: 2, head: 6 });
    expect(run(v, underlineCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("x <u>word</u> y");
    expect(v.state.doc.toString()).not.toContain("_word_");
  });

  it("strikethrough wraps with ~~ .. ~~", () => {
    const v = mount("x word y", { anchor: 2, head: 6 });
    expect(run(v, strikethroughCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("x ~~word~~ y");
  });
});

describe("link / code-fence commands", () => {
  it("link produces [sel]() with the caret inside the empty url parens", () => {
    const v = mount("see here now", { anchor: 4, head: 8 }); // "here"
    expect(run(v, linkCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("see [here]() now");
    expect(v.state.selection.main.empty).toBe(true);
    expect(v.state.selection.main.head).toBe(11);
    expect(v.state.sliceDoc(0, v.state.selection.main.head)).toBe("see [here](");
  });

  it("fenced-code wraps the selection in a fenced code block", () => {
    const v = mount("run x", { anchor: 4, head: 5 }); // "x"
    expect(run(v, fencedCodeCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("run ```\nx\n```");
  });
});

describe("line-prefix commands (headings / blockquote)", () => {
  it("heading-1 adds a '# ' marker to the caret line", () => {
    const v = mount("title line", { anchor: 3, head: 3 });
    expect(run(v, headingCommandFor(1))).toBe(true);
    expect(v.state.doc.toString()).toBe("# title line");
  });

  it("heading-1 again on the same '# ' line toggles the marker OFF", () => {
    const v = mount("# title line", { anchor: 4, head: 4 });
    expect(run(v, headingCommandFor(1))).toBe(true);
    expect(v.state.doc.toString()).toBe("title line");
  });

  it("heading-2 on an existing '# ' line replaces it with '## ' (family-aware)", () => {
    const v = mount("# title line", { anchor: 4, head: 4 });
    expect(run(v, headingCommandFor(2))).toBe(true);
    expect(v.state.doc.toString()).toBe("## title line");
  });

  it("heading-6 adds a level-6 marker", () => {
    const v = mount("deep", { anchor: 2, head: 2 });
    expect(run(v, headingCommandFor(6))).toBe(true);
    expect(v.state.doc.toString()).toBe("###### deep");
  });

  it("blockquote adds a '> ' marker, and a second press toggles it off", () => {
    const v = mount("quote me", { anchor: 2, head: 2 });
    expect(run(v, blockquoteCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("> quote me");
    expect(run(v, blockquoteCommand)).toBe(true);
    expect(v.state.doc.toString()).toBe("quote me");
  });
});

describe("keymap registration: the 8 hybrid shortcut families are bound", () => {
  it("binds Mod-b/i/u, Mod-Shift-x, Mod-k, the code-fence combo, Mod-1..6, Ctrl-q", () => {
    const keys = markdownKeyBindings.map((b) => b.key);
    expect(keys).toContain("Mod-b");
    expect(keys).toContain("Mod-i");
    expect(keys).toContain("Mod-u");
    expect(keys).toContain("Mod-Shift-x");
    expect(keys).toContain("Mod-k");
    expect(keys).toContain("Mod-Shift-c");
    for (let lvl = 1; lvl <= 6; lvl++) expect(keys).toContain(`Mod-${lvl}`);
    expect(keys).toContain("Ctrl-q");
    // Every binding carries a run handler.
    expect(markdownKeyBindings.every((b) => typeof b.run === "function")).toBe(true);
  });
});
