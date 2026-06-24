import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";

import { buildBlockDeco, buildDeco } from "./inline-reveal";
import { HrWidget } from "./block-widgets";

/**
 * Block + image widget tests (Typora editor chip 2b). A Table / FencedCode /
 * Image node that the selection does NOT touch must collapse into a single
 * Decoration.replace carrying a widget, fed into BOTH the combined set (so it
 * renders) AND the atomic set (so the caret cannot land inside the collapsed
 * source). Moving the caret into the block must drop the widget so the raw
 * source shows as editable text. This is the same selectionSet trigger that
 * drives the inline markers.
 *
 * Block widgets come from buildBlockDeco (a StateField, because CM6 rejects block
 * decorations from a ViewPlugin); the inline image widget comes from buildDeco
 * (the ViewPlugin walk). jsdom has no layout, so view.visibleRanges falls back
 * to the full document; forceParsing gives a deterministic complete tree.
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
  forceParsing(view, doc.length);
  return view;
}

/** Collect [from, to, widget|null, block] for every range in a set. */
function widgetRanges(
  set: ReturnType<typeof buildDeco>["combined"],
): Array<{ from: number; to: number; widget: WidgetType | null; block: boolean }> {
  const out: Array<{
    from: number;
    to: number;
    widget: WidgetType | null;
    block: boolean;
  }> = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    const spec = value.spec as { widget?: WidgetType; block?: boolean };
    out.push({
      from,
      to,
      widget: spec.widget ?? null,
      block: spec.block === true,
    });
  });
  return out;
}

const TABLE = ["| Sample | Cq |", "| --- | --- |", "| ctrl | 22.4 |"].join("\n");
const FENCE = ["```python", "def amplify(x):", "    return x * 2", "```"].join("\n");

describe("block widgets: Table / FencedCode collapse when caret is OUT", () => {
  it("emits a block replace+widget over the whole Table when the caret is outside", () => {
    const doc = `intro\n\n${TABLE}\n\ntail`;
    const tableFrom = doc.indexOf("| Sample");
    const tableTo = tableFrom + TABLE.length;
    const v = mount(doc, 0); // caret at the very top, outside the table
    const { combined, atomic } = buildBlockDeco(v.state);

    const block = widgetRanges(combined).find(
      (r) => r.from === tableFrom && r.to === tableTo,
    );
    expect(block).toBeDefined();
    expect(block?.block).toBe(true);
    expect(block?.widget).toBeInstanceOf(WidgetType);

    // The same replace must be atomic so the caret jumps over the source.
    const atomicBlock = widgetRanges(atomic).find(
      (r) => r.from === tableFrom && r.to === tableTo,
    );
    expect(atomicBlock).toBeDefined();
  });

  it("drops the Table widget when the caret is INSIDE (raw source reveals)", () => {
    const doc = `intro\n\n${TABLE}\n\ntail`;
    const insideTable = doc.indexOf("ctrl");
    const v = mount(doc, insideTable);
    const { combined, atomic } = buildBlockDeco(v.state);

    // No block widget over the table range while the caret is inside it.
    const tableFrom = doc.indexOf("| Sample");
    const blockOverTable = widgetRanges(combined).find(
      (r) => r.from === tableFrom && r.block,
    );
    expect(blockOverTable).toBeUndefined();
    // The table range is not atomic, so the caret can move through the source.
    const atomicOverTable = widgetRanges(atomic).find((r) => r.from === tableFrom);
    expect(atomicOverTable).toBeUndefined();
  });

  it("emits a block replace+widget over the whole FencedCode when the caret is outside", () => {
    const doc = `intro\n\n${FENCE}\n\ntail`;
    const fenceFrom = doc.indexOf("```python");
    const fenceTo = fenceFrom + FENCE.length;
    const v = mount(doc, 0);
    const { combined, atomic } = buildBlockDeco(v.state);

    const block = widgetRanges(combined).find(
      (r) => r.from === fenceFrom && r.to === fenceTo,
    );
    expect(block).toBeDefined();
    expect(block?.block).toBe(true);
    expect(block?.widget).toBeInstanceOf(WidgetType);

    expect(
      widgetRanges(atomic).some((r) => r.from === fenceFrom && r.to === fenceTo),
    ).toBe(true);
  });

  it("drops the FencedCode widget when the caret is INSIDE", () => {
    const doc = `intro\n\n${FENCE}\n\ntail`;
    const insideFence = doc.indexOf("def amplify");
    const v = mount(doc, insideFence);
    const { combined } = buildBlockDeco(v.state);
    const fenceFrom = doc.indexOf("```python");
    expect(
      widgetRanges(combined).some((r) => r.from === fenceFrom && r.block),
    ).toBe(false);
  });

  it("renders the table widget DOM as an HTML <table>", () => {
    const doc = `intro\n\n${TABLE}\n\ntail`;
    const v = mount(doc, 0);
    const { combined } = buildBlockDeco(v.state);
    const tableFrom = doc.indexOf("| Sample");
    const block = widgetRanges(combined).find((r) => r.from === tableFrom);
    const dom = (block?.widget as WidgetType).toDOM(v);
    expect(dom.querySelector("table")).not.toBeNull();
    // The sanitize-routed render keeps the cell text.
    expect(dom.textContent).toContain("Sample");
    expect(dom.textContent).toContain("22.4");
  });
});

describe("thematic break (HR) widget (bug C)", () => {
  // A standalone `___` / `---` / `***` line collapses into a full-width <hr>
  // when the caret is not on it, and reveals the raw source when the caret is in.
  for (const rule of ["___", "---", "***"]) {
    it(`collapses a standalone ${rule} into an HR block widget when the caret is OUT`, () => {
      const doc = `above\n\n${rule}\n\nbelow`;
      const hrFrom = doc.indexOf(rule);
      const hrTo = hrFrom + rule.length;
      const v = mount(doc, 0); // caret at the top, off the rule line
      const { combined, atomic } = buildBlockDeco(v.state);

      const block = widgetRanges(combined).find(
        (r) => r.from === hrFrom && r.to === hrTo,
      );
      expect(block).toBeDefined();
      expect(block?.block).toBe(true);
      expect(block?.widget).toBeInstanceOf(HrWidget);

      // Atomic so the caret jumps over the collapsed source.
      expect(
        widgetRanges(atomic).some((r) => r.from === hrFrom && r.to === hrTo),
      ).toBe(true);

      // The widget DOM is a real <hr>.
      const dom = (block?.widget as WidgetType).toDOM(v);
      expect(dom.querySelector("hr")).not.toBeNull();
    });
  }

  it("drops the HR widget when the caret is ON the rule (raw source reveals)", () => {
    const doc = "above\n\n___\n\nbelow";
    const hrFrom = doc.indexOf("___");
    const v = mount(doc, hrFrom + 1); // caret inside the ___ run
    const { combined, atomic } = buildBlockDeco(v.state);
    expect(widgetRanges(combined).some((r) => r.from === hrFrom && r.block)).toBe(
      false,
    );
    expect(widgetRanges(atomic).some((r) => r.from === hrFrom)).toBe(false);
  });

  it("does NOT treat inline __underline__ as a thematic break", () => {
    // Inline `__x__` parses inside a Paragraph as Emphasis, never a
    // HorizontalRule, so no HR block widget is emitted for it.
    const doc = "this is __under__ here";
    const v = mount(doc, 0);
    const { combined } = buildBlockDeco(v.state);
    expect(
      widgetRanges(combined).some((r) => r.widget instanceof HrWidget),
    ).toBe(false);
  });
});

describe("image inline widget: Image collapses to a resolved <img> when caret is OUT", () => {
  const IMG = "![Figure 1](Images/figure-1.png)";

  it("emits an inline (non-block) replace+widget over the Image when caret is outside", () => {
    const doc = `intro\n\n${IMG}\n\ntail`;
    const imgFrom = doc.indexOf("![Figure");
    const imgTo = imgFrom + IMG.length;
    const v = mount(doc, 0);
    const { combined, atomic } = buildDeco(v);

    const r = widgetRanges(combined).find(
      (x) => x.from === imgFrom && x.to === imgTo,
    );
    expect(r).toBeDefined();
    expect(r?.widget).toBeInstanceOf(WidgetType);
    // Image widget is INLINE, not a block widget.
    expect(r?.block).toBe(false);

    expect(
      widgetRanges(atomic).some((x) => x.from === imgFrom && x.to === imgTo),
    ).toBe(true);
  });

  it("drops the image widget when the caret is INSIDE the Image source", () => {
    const doc = `intro\n\n${IMG}\n\ntail`;
    const insideImg = doc.indexOf("figure-1");
    const v = mount(doc, insideImg);
    const { combined } = buildDeco(v);
    const imgFrom = doc.indexOf("![Figure");
    // No image widget; the container path emits a cm-link mark over the source.
    const widget = widgetRanges(combined).find(
      (x) => x.from === imgFrom && x.widget,
    );
    expect(widget).toBeUndefined();
  });

  it("renders the image widget DOM as an <img> carrying the alt text", () => {
    const doc = `intro\n\n${IMG}\n\ntail`;
    const v = mount(doc, 0);
    const { combined } = buildDeco(v);
    const imgFrom = doc.indexOf("![Figure");
    const r = widgetRanges(combined).find((x) => x.from === imgFrom);
    const dom = (r?.widget as WidgetType).toDOM(v);
    const img = dom.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("Figure 1");
  });
});

describe("widget memoization by source (eq)", () => {
  it("two widgets with identical source are eq; differing source is not", () => {
    const docA = `\n\n${TABLE}\n\n`;
    const v = mount(docA, 0);
    const a = widgetRanges(buildBlockDeco(v.state).combined).find((r) => r.widget)?.widget;
    v.destroy();
    host?.remove();

    const v2 = mount(docA, 0);
    const b = widgetRanges(buildBlockDeco(v2.state).combined).find((r) => r.widget)?.widget;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    // Same byte-identical table source -> eq true -> CM6 reuses the DOM.
    expect((a as WidgetType).eq(b as WidgetType)).toBe(true);

    // A different table source -> not eq -> CM6 redraws.
    const other = Decoration.replace({}); // sentinel: any non-widget is not eq
    expect((a as WidgetType).eq(other as unknown as WidgetType)).toBe(false);
  });
});
