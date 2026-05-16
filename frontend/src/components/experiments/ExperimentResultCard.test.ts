import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview } from "./ExperimentResultCard";

/**
 * Hero-area preview rendering tests. Verifies that resultsPreview content is
 * rendered through the sanitized markdown pipeline (per `03f77091`) with the
 * compact, non-interactive overrides documented in ExperimentResultCard.tsx —
 * driven by Grant's UX feedback that the previous `<pre>` block leaked raw
 * markdown syntax into the gallery card.
 *
 * Vitest runs in node env; we use renderToStaticMarkup on MarkdownPreview in
 * isolation so we don't have to wire up the file-system context that the
 * full card pulls in via UserAvatar.
 */

function renderPreview(content: string): string {
  return renderToStaticMarkup(React.createElement(MarkdownPreview, { content }));
}

describe("ExperimentResultCard / MarkdownPreview", () => {
  it("renders headings as compact bold blocks, not full-size <h1>/<h2>", () => {
    const html = renderPreview("# Results: Foo\n\nbar baz");
    expect(html).not.toMatch(/<h1[ >]/i);
    expect(html).not.toMatch(/<h2[ >]/i);
    // The heading text survives — just rendered as a compact <strong>.
    expect(html).toContain("Results: Foo");
    expect(html).toMatch(/<strong[^>]*class="[^"]*text-\[12px\][^"]*"[^>]*>/);
  });

  it("renders markdown links as non-clickable spans (no <a href>)", () => {
    const html = renderPreview("see [test.json](Files/test.json) for details");
    expect(html).not.toMatch(/<a[^>]*href=/i);
    // Link text is preserved with link-like styling.
    expect(html).toContain("test.json");
    expect(html).toMatch(
      /<span[^>]*class="[^"]*text-blue-600[^"]*underline[^"]*"[^>]*>/,
    );
  });

  it("clamps the preview to the hero area via overflow-hidden + max-h-full", () => {
    const longContent = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(
      "\n\n",
    );
    const html = renderPreview(longContent);
    // The wrapper div carries the size + clamp classes that keep the preview
    // confined to the hero strip.
    expect(html).toMatch(/class="[^"]*overflow-hidden[^"]*"/);
    expect(html).toMatch(/class="[^"]*max-h-full[^"]*"/);
  });

  it("strips dangerous markup before rendering (sanitize pipeline still applied)", () => {
    const html = renderPreview("<script>alert(1)</script>\n\nok");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/alert\(1\)/);
    expect(html).toContain("ok");
  });
});
