/**
 * render-html.test.ts: guards the block-widget HTML render (chip 2b).
 *
 * Regression focus: the remark-gfm -> remark-rehype -> rehype-raw round-trip
 * emits a run of leading newline text nodes before a rendered table (roughly one
 * per row). A CM6 block widget paints this string with innerHTML inside a wrapper
 * that inherits `white-space: break-spaces` from `.cm-content`, so each stray
 * newline used to render as a visible blank LINE. The effect: a one-row table
 * showed as a ~700px-tall mostly-empty widget that pushed the real <table> out of
 * the popup viewport, so the table "vanished" the moment the caret left it. The
 * fix trims the outer whitespace; these tests lock that in so it cannot regress.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import {
  renderTableHtml,
  renderFencedCodeHtml,
  renderImageHtml,
} from "./render-html";

describe("renderTableHtml whitespace bound", () => {
  const table =
    "| Cluster | Type | Closest known |\n" +
    "| --- | --- | --- |\n" +
    "| 1 | NRPS | gliotoxin |\n" +
    "| 2 | PKS | fumonisin |";

  it("emits no leading or trailing whitespace", () => {
    const html = renderTableHtml(table);
    expect(html).toBe(html.trim());
  });

  it("does not begin with a newline text node (the blank-line inflation bug)", () => {
    const html = renderTableHtml(table);
    // The widget sets this via innerHTML inside a break-spaces wrapper. A leading
    // newline run is exactly what rendered as blank lines and ballooned the
    // widget height, so the very first character must be the opening tag.
    expect(html.startsWith("<table")).toBe(true);
    expect(/^\s*\n/.test(html)).toBe(false);
  });

  it("still renders the full table content", () => {
    const html = renderTableHtml(table);
    expect(html).toContain("<table");
    expect(html).toContain("Cluster");
    expect(html).toContain("gliotoxin");
    expect(html).toContain("fumonisin");
  });

  it("scales clean across row counts (no per-row whitespace leaks out front)", () => {
    for (const rows of [1, 5, 25]) {
      let src = "| a | b |\n| --- | --- |\n";
      for (let i = 0; i < rows; i++) src += `| ${i} | x |\n`;
      const html = renderTableHtml(src.trimEnd());
      expect(html.startsWith("<table")).toBe(true);
      expect(html).toBe(html.trim());
    }
  });
});

describe("renderFencedCodeHtml preserves inner newlines", () => {
  it("trims only the outer whitespace, keeping the code body intact", () => {
    const fence = "```js\nconst x = 1;\nconst y = 2;\n```";
    const html = renderFencedCodeHtml(fence);
    expect(html).toBe(html.trim());
    expect(html.startsWith("<pre")).toBe(true);
    // The newline INSIDE the code block is meaningful and must survive the outer
    // trim (it sits within <pre><code>, not at the string edges).
    expect(html).toContain("\n");
    expect(html).toContain("const");
  });
});

describe("renderImageHtml whitespace bound", () => {
  it("emits no leading or trailing whitespace", () => {
    const html = renderImageHtml("![alt](Images/x.png)");
    expect(html).toBe(html.trim());
  });
});
