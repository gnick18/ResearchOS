/**
 * image-widget.test.tsx: unit tests for the embed-controls upgrade to
 * ImageWidget.toDOM (caption + width sizing from #w= fragment).
 *
 * Mirrors the block-widgets.test.tsx harness: jsdom via .tsx extension,
 * same mount/afterEach pattern, same buildDeco usage.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";

import { buildDeco } from "./inline-reveal";

const views: EditorView[] = [];
const hosts: HTMLDivElement[] = [];

afterEach(() => {
  for (const v of views) v.destroy();
  views.length = 0;
  for (const h of hosts) h.remove();
  hosts.length = 0;
});

function mount(doc: string, selectionAt: number): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(selectionAt),
      extensions: [markdown({ base: markdownLanguage })],
    }),
    parent: host,
  });
  views.push(v);
  forceParsing(v, doc.length);
  return v;
}

/**
 * Collect the ImageWidget DOM for the first image node in the given image
 * markdown source (e.g. `![alt](Images/foo.png)`). Wraps it in `intro\n\n...\n\ntail`
 * so CM6 parses it as an image inside a paragraph (not a bare single-line doc)
 * and emits the inline-replace widget, mirroring the existing block-widgets tests.
 */
function imageWidgetDom(imgSource: string): HTMLElement | null {
  const doc = `intro\n\n${imgSource}\n\ntail`;
  const v = mount(doc, 0);
  const { combined } = buildDeco(v);
  let dom: HTMLElement | null = null;
  combined.between(0, doc.length, (_from, _to, value) => {
    const spec = value.spec as { widget?: WidgetType };
    if (spec.widget) {
      dom = (spec.widget as WidgetType).toDOM(v) as HTMLElement;
      return false;
    }
  });
  return dom;
}

describe("ImageWidget embed controls: #w= width", () => {
  it("applies max-width on the <img> when src contains #w=<number>", () => {
    const dom = imageWidgetDom("![alt text](Images/fig.png#w=350)");
    expect(dom).not.toBeNull();
    const img = dom?.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.style.maxWidth).toBe("350px");
  });

  it("strips the #w= fragment from the src before the blob resolver sees it", () => {
    const dom = imageWidgetDom("![alt text](Images/fig.png#w=350)");
    const img = dom?.querySelector("img");
    // The src will be the placeholder GIF (local path triggers blob resolution).
    // data-orig-src holds the clean path used for resolution.
    const src = img?.getAttribute("src") ?? "";
    const dataOrig = img?.getAttribute("data-orig-src") ?? "";
    expect(src).not.toContain("#w=");
    expect(dataOrig).not.toContain("#w=");
    // The real path (stored in data-orig-src for local paths) must keep the
    // filename without the fragment.
    expect(dataOrig).toContain("fig.png");
  });

  it("does NOT set max-width when there is no #w= fragment", () => {
    const dom = imageWidgetDom("![Figure 1](Images/figure-1.png)");
    const img = dom?.querySelector("img");
    // maxWidth must be empty (not set at all) for images without #w=.
    expect(img?.style.maxWidth).toBeFalsy();
  });
});

describe("ImageWidget embed controls: alt caption", () => {
  it("appends a figcaption with the alt text when alt is non-empty", () => {
    const dom = imageWidgetDom("![Western blot](Images/blot.png)");
    expect(dom).not.toBeNull();
    const caption = dom?.querySelector("figcaption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe("Western blot");
  });

  it("does NOT render a figcaption when alt is empty", () => {
    const dom = imageWidgetDom("![](Images/fig.png)");
    expect(dom).not.toBeNull();
    expect(dom?.querySelector("figcaption")).toBeNull();
  });

  it("renders both caption and max-width when alt and #w are both present", () => {
    const dom = imageWidgetDom("![Colony count](Images/plate.png#w=480)");
    expect(dom).not.toBeNull();
    expect(dom?.querySelector("figcaption")?.textContent).toBe("Colony count");
    expect(dom?.querySelector("img")?.style.maxWidth).toBe("480px");
  });
});
