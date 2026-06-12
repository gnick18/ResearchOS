import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";

import { buildBlockDeco } from "./inline-reveal";
import { EmbedWidget, parseLoneEmbedLink } from "./embed-widget";

// Phase 2: a paragraph that is a lone object-embed link, when the caret does not
// touch it, must collapse into a block:true Decoration.replace carrying an
// EmbedWidget (fed into the combined + atomic sets). Caret on the line drops the
// widget so the raw source shows. Same selectionSet reveal trigger as the table /
// image widgets. jsdom has no layout, forceParsing gives a complete tree.

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

function embedWidget(state: EditorState): EmbedWidget | null {
  let found: EmbedWidget | null = null;
  buildBlockDeco(state).combined.between(0, Number.MAX_SAFE_INTEGER, (_f, _t, value) => {
    const w = (value.spec as { widget?: WidgetType }).widget;
    if (w instanceof EmbedWidget) found = w;
  });
  return found;
}

describe("parseLoneEmbedLink", () => {
  it("parses a lone embed link to its descriptor + caption", () => {
    expect(parseLoneEmbedLink("[pUC19 map](/sequences?seq=5#ros=map)")).toMatchObject({
      caption: "pUC19 map",
      descriptor: { type: "sequence", id: "5", view: "map", isEmbed: true },
    });
  });

  it("returns null for a plain mention (no #ros)", () => {
    expect(parseLoneEmbedLink("[pUC19](/sequences?seq=5)")).toBeNull();
  });

  it("returns null when there is surrounding text", () => {
    expect(parseLoneEmbedLink("see [x](/sequences?seq=5#ros=map) here")).toBeNull();
  });

  it("unescapes brackets in the caption", () => {
    expect(
      parseLoneEmbedLink("[pGEX \\[clone\\]](/sequences?seq=5#ros=map)")?.caption,
    ).toBe("pGEX [clone]");
  });
});

describe("buildBlockDeco object embeds", () => {
  const doc = "[pUC19 map](/sequences?seq=5#ros=map)\n\nx";

  it("collapses a lone embed paragraph into a block embed widget when untouched", () => {
    const v = mount(doc, doc.length); // caret in the trailing "x"
    const w = embedWidget(v.state);
    expect(w).toBeInstanceOf(EmbedWidget);
    expect(w?.descriptor).toMatchObject({ type: "sequence", id: "5", view: "map" });
    expect(w?.caption).toBe("pUC19 map");
  });

  it("reveals the raw source when the caret is on the embed line", () => {
    const v = mount(doc, 3); // caret inside the link
    expect(embedWidget(v.state)).toBeNull();
  });

  it("does not embed a plain mention link", () => {
    const mention = "[pUC19](/sequences?seq=5)\n\nx";
    const v = mount(mention, mention.length);
    expect(embedWidget(v.state)).toBeNull();
  });
});
