// @vitest-environment jsdom
/**
 * Coverage for the in-place view-switch rewrite (markdown embed hybrid, P7-3).
 *
 * The widget persists a view switch by rewriting ONLY the embed href's #ros view
 * on the source line, leaving the caption and the rest of the document byte-for-
 * byte. These tests prove that the pure line rewrite swaps only the view, and that
 * dispatching the change through a real EditorView touches only the embed line.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import {
  rewriteLoneEmbedLine,
  rewriteEmbedViewAtLine,
  rewriteEmbedPinLine,
  rewriteEmbedPinAtLine,
} from "./embed-widget";

describe("rewriteLoneEmbedLine (pure)", () => {
  it("swaps only the view, preserving the caption", () => {
    const before = "[pUC19 map](/sequences?seq=2#ros=map)";
    expect(rewriteLoneEmbedLine(before, "bases")).toBe(
      "[pUC19 map](/sequences?seq=2#ros=bases)",
    );
  });

  it("preserves opts in the fragment across the swap", () => {
    const before = "[Growth curve](/datahub?doc=2#ros=table&rows=8&cols=4)";
    const after = rewriteLoneEmbedLine(before, "plot");
    expect(after).toBe("[Growth curve](/datahub?doc=2#ros=plot&rows=8&cols=4)");
  });

  it("preserves a caption that contains brackets and parens", () => {
    const before = "[pGEX-3X \\[clone\\] (U13852)](/sequences?seq=2#ros=map)";
    const after = rewriteLoneEmbedLine(before, "bases");
    expect(after).toBe("[pGEX-3X \\[clone\\] (U13852)](/sequences?seq=2#ros=bases)");
  });

  it("returns null for a line that is not a lone embed link", () => {
    expect(rewriteLoneEmbedLine("just some prose", "map")).toBeNull();
    // A plain object link (no #ros) is not an embed, so the swap is a no-op.
    expect(rewriteLoneEmbedLine("[pUC19](/sequences?seq=2)", "map")).toBeNull();
  });

  it("round-trips back to the original view byte-for-byte", () => {
    const original = "[Growth curve](/datahub?doc=2#ros=table&rows=8&cols=4)";
    const flipped = rewriteLoneEmbedLine(original, "plot")!;
    const back = rewriteLoneEmbedLine(flipped, "table")!;
    expect(back).toBe(original);
  });
});

describe("rewriteEmbedViewAtLine (dispatches against a real EditorView)", () => {
  function viewFor(doc: string): EditorView {
    const state = EditorState.create({ doc, extensions: [markdown()] });
    return new EditorView({ state, parent: document.body });
  }

  it("rewrites the embed line and leaves the rest of the doc byte-identical", () => {
    const before = [
      "# Notes",
      "",
      "[pUC19 map](/sequences?seq=2#ros=map)",
      "",
      "Some trailing prose.",
    ].join("\n");
    const view = viewFor(before);
    // pos somewhere inside the embed line (the start of line 3).
    const pos = view.state.doc.line(3).from;
    rewriteEmbedViewAtLine(view, pos, "bases");
    const after = view.state.doc.toString();
    expect(after).toBe(
      [
        "# Notes",
        "",
        "[pUC19 map](/sequences?seq=2#ros=bases)",
        "",
        "Some trailing prose.",
      ].join("\n"),
    );
    view.destroy();
  });

  it("does nothing when the line at pos is not a lone embed", () => {
    const before = "# Notes\n\nplain prose line";
    const view = viewFor(before);
    const pos = view.state.doc.line(3).from;
    rewriteEmbedViewAtLine(view, pos, "bases");
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });

  it("does nothing (no throw) when the swap is a no-op", () => {
    // A lone link with no #ros is not an embed, so swapEmbedView no-ops.
    const before = "[pUC19](/sequences?seq=2)";
    const view = viewFor(before);
    rewriteEmbedViewAtLine(view, view.state.doc.line(1).from, "map");
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });
});

describe("rewriteEmbedPinLine (pure, P7-1a)", () => {
  it("adds a pin opt, preserving the caption and the view", () => {
    const before = "[pUC19 map](/sequences?seq=2#ros=map)";
    expect(rewriteEmbedPinLine(before, "s_abc123")).toBe(
      "[pUC19 map](/sequences?seq=2#ros=map&pin=s_abc123)",
    );
  });

  it("removes the pin opt when pinId is null", () => {
    const before = "[pUC19 map](/sequences?seq=2#ros=map&pin=s_abc123)";
    expect(rewriteEmbedPinLine(before, null)).toBe(
      "[pUC19 map](/sequences?seq=2#ros=map)",
    );
  });

  it("add then remove returns the original line byte-for-byte", () => {
    const original = "[Growth curve](/datahub?doc=2#ros=table&rows=8&cols=4)";
    const pinned = rewriteEmbedPinLine(original, "s_xy9zab")!;
    const back = rewriteEmbedPinLine(pinned, null)!;
    expect(back).toBe(original);
  });

  it("preserves a caption with brackets and parens across a pin", () => {
    const before = "[pGEX-3X \\[clone\\] (U13852)](/sequences?seq=2#ros=map)";
    expect(rewriteEmbedPinLine(before, "s_abc123")).toBe(
      "[pGEX-3X \\[clone\\] (U13852)](/sequences?seq=2#ros=map&pin=s_abc123)",
    );
  });

  it("returns null for a line that is not a lone embed link", () => {
    expect(rewriteEmbedPinLine("just prose", "s_abc123")).toBeNull();
    // A plain object link (no #ros) is not an embed, so the rewrite is a no-op.
    expect(rewriteEmbedPinLine("[pUC19](/sequences?seq=2)", "s_abc123")).toBeNull();
  });
});

describe("rewriteEmbedPinAtLine (dispatches against a real EditorView, P7-1a)", () => {
  function viewFor(doc: string): EditorView {
    const state = EditorState.create({ doc, extensions: [markdown()] });
    return new EditorView({ state, parent: document.body });
  }

  it("pins the embed line and leaves the rest of the doc byte-identical", () => {
    const before = [
      "# Notes",
      "",
      "[pUC19 map](/sequences?seq=2#ros=map)",
      "",
      "Trailing prose.",
    ].join("\n");
    const view = viewFor(before);
    const pos = view.state.doc.line(3).from;
    rewriteEmbedPinAtLine(view, pos, "s_abc123");
    expect(view.state.doc.toString()).toBe(
      [
        "# Notes",
        "",
        "[pUC19 map](/sequences?seq=2#ros=map&pin=s_abc123)",
        "",
        "Trailing prose.",
      ].join("\n"),
    );
    view.destroy();
  });

  it("unpinning restores the original document byte-for-byte", () => {
    const original = [
      "# Notes",
      "",
      "[pUC19 map](/sequences?seq=2#ros=map)",
      "",
      "Trailing prose.",
    ].join("\n");
    const view = viewFor(original);
    const pos = () => view.state.doc.line(3).from;
    rewriteEmbedPinAtLine(view, pos(), "s_abc123");
    rewriteEmbedPinAtLine(view, pos(), null);
    expect(view.state.doc.toString()).toBe(original);
    view.destroy();
  });

  it("does nothing when the line at pos is not a lone embed", () => {
    const before = "# Notes\n\nplain prose line";
    const view = viewFor(before);
    rewriteEmbedPinAtLine(view, view.state.doc.line(3).from, "s_abc123");
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });
});
