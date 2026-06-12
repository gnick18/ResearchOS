import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";

import { buildDeco } from "./inline-reveal";
import { ObjectChipWidget, parseObjectLink } from "./object-chip-widget";

// Phase 2: an object-mention Link, when the caret does not touch it, collapses
// into an inline chip widget. Caret on the link drops the widget so the raw
// source shows. A normal external link is never chipped. jsdom has no layout, so
// visibleRanges falls back to the whole document; forceParsing gives a complete
// tree.

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
  forceParsing(view, doc.length);
  return view;
}

function chip(view: EditorView): ObjectChipWidget | null {
  let found: ObjectChipWidget | null = null;
  buildDeco(view).combined.between(0, Number.MAX_SAFE_INTEGER, (_f, _t, value) => {
    const w = (value.spec as { widget?: WidgetType }).widget;
    if (w instanceof ObjectChipWidget) found = w;
  });
  return found;
}

describe("parseObjectLink", () => {
  it("parses an object mention link", () => {
    expect(parseObjectLink("[pUC19](/sequences?seq=5)")).toEqual({
      label: "pUC19",
      type: "sequence",
    });
  });

  it("returns null for a normal external link", () => {
    expect(parseObjectLink("[NCBI](https://ncbi.nlm.nih.gov)")).toBeNull();
  });
});

describe("buildDeco object-mention chips", () => {
  it("chips an untouched mention link mid-sentence", () => {
    const doc = "See [pUC19](/sequences?seq=5) for the map.";
    const v = mount(doc, doc.length); // caret at the end
    const w = chip(v);
    expect(w).toBeInstanceOf(ObjectChipWidget);
    expect(w?.label).toBe("pUC19");
    expect(w?.type).toBe("sequence");
  });

  it("reveals the raw source when the caret is on the link", () => {
    const doc = "See [pUC19](/sequences?seq=5) here.";
    const v = mount(doc, 8); // caret inside the link text
    expect(chip(v)).toBeNull();
  });

  it("does not chip a normal external link", () => {
    const doc = "See [NCBI](https://ncbi.nlm.nih.gov) here.";
    const v = mount(doc, doc.length);
    expect(chip(v)).toBeNull();
  });
});
