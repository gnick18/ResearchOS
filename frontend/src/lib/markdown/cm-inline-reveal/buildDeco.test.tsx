import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";

import { buildDeco } from "./inline-reveal";

/**
 * buildDeco walk tests (Typora editor chip 2a). These mount a real CM6
 * EditorView with the GFM markdown base, force a full parse, move the caret in
 * and out of a token, and assert which MARKER ranges get collapsed
 * (Decoration.replace) vs left as source. The atomic set must equal the replace
 * set so the caret jumps over hidden markers.
 *
 * jsdom has no layout, so view.visibleRanges falls back to the full document;
 * combined with forceParsing this gives a deterministic complete tree to walk.
 */

let host: HTMLDivElement | null = null;
let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  host?.remove();
  host = null;
});

function mount(doc: string, selectionAt: number): EditorView {
  host = document.createElement("div");
  document.body.appendChild(host);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(selectionAt),
      extensions: [markdown({ base: markdownLanguage })],
    }),
    parent: host,
  });
  // Ensure the lezer tree is fully parsed before we walk it.
  forceParsing(view, doc.length);
  return view;
}

/** Collect [from,to] pairs of every range in a decoration set. */
function ranges(
  set: ReturnType<typeof buildDeco>["combined"],
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to) => {
    out.push([from, to]);
  });
  return out;
}

describe("buildDeco replace ranges (markers hide when caret is OUT)", () => {
  it("collapses both ** marks of bold when the caret is outside the token", () => {
    // doc: "x **bold** y" -> StrongEmphasis at [2, 10); marks at [2,4) and [8,10).
    const doc = "x **bold** y";
    const v = mount(doc, 0); // caret at very start, outside the bold token
    const { combined, atomic } = buildDeco(v);

    const atomicPairs = ranges(atomic);
    // The two ** delimiter runs must be in the atomic (replace-only) set.
    expect(atomicPairs).toContainEqual([2, 4]);
    expect(atomicPairs).toContainEqual([8, 10]);

    // The combined set must include those two replaces PLUS a content mark over
    // the WHOLE StrongEmphasis container [2, 10). Marking the full container
    // range (markers included) is intentional and safe: the markers are
    // collapsed to zero width by the replaces, so only the surviving "bold"
    // content actually shows the cm-strong style.
    const combinedPairs = ranges(combined);
    expect(combinedPairs).toContainEqual([2, 4]);
    expect(combinedPairs).toContainEqual([8, 10]);
    expect(combinedPairs).toContainEqual([2, 10]);
  });

  it("does NOT collapse the ** marks when the caret is inside the token", () => {
    const doc = "x **bold** y";
    const v = mount(doc, 5); // caret inside "bold" -> reveal
    const { combined, atomic } = buildDeco(v);

    // No replace ranges (reveal): atomic set is empty.
    expect(ranges(atomic)).toHaveLength(0);

    // The content mark stays over the whole container so the token is still
    // styled even with the raw ** delimiters showing as source.
    expect(ranges(combined)).toContainEqual([2, 10]);
  });

  it("reveals at the boundary (caret exactly at the closing **)", () => {
    const doc = "x **bold** y";
    // Offset 10 is the position right after the closing **, the node `to`.
    const v = mount(doc, 10);
    const { atomic } = buildDeco(v);
    // Closed-interval reveal: boundary caret reveals, so no replace.
    expect(ranges(atomic)).toHaveLength(0);
  });

  it("emphasis: underscore content gets cm-underline, asterisk gets cm-em", () => {
    const u = mount("a _under_ b", 0);
    let foundUnderline = false;
    buildDeco(u).combined.between(0, 100, (_f, _t, value) => {
      const cls = (value.spec as { class?: string } | undefined)?.class;
      if (cls === "cm-underline") foundUnderline = true;
    });
    expect(foundUnderline).toBe(true);
    u.destroy();

    host?.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    const i = new EditorView({
      state: EditorState.create({
        doc: "a *ital* b",
        selection: EditorSelection.cursor(0),
        extensions: [markdown({ base: markdownLanguage })],
      }),
      parent: host,
    });
    forceParsing(i, 10);
    let foundEm = false;
    buildDeco(i).combined.between(0, 100, (_f, _t, value) => {
      const cls = (value.spec as { class?: string } | undefined)?.class;
      if (cls === "cm-em") foundEm = true;
    });
    expect(foundEm).toBe(true);
    i.destroy();
    view = null;
  });
});
