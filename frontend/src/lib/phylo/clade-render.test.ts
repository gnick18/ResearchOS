// Wave 2 clade-decoration render guards. These drive the SAME path the live
// Tree Studio uses (figureToRenderSpec -> renderTreeSvg) on the real HPV58 demo
// tree, proving a clade named by tip MEMBERS paints in every style: a highlight
// band, a bracket (style=label), and a collapsed triangle. Browser testing once
// reported these as blank; that turned out to be a native-<select> commit
// artifact, not a render bug, but these lock the render contract regardless.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTree } from "./parse";
import { mrca } from "./layout";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import type { AlignedPanel } from "./types";

const TREE = parseTree(
  readFileSync(
    resolve(__dirname, "../../../public/demo-data/users/alex/phylo/3.tree"),
    "utf8",
  ),
);
const MEMBERS = ["SC144|FJ385264", "RW63|HQ537771"];
const EMPTY_TRACKS = {
  labels: false, labelsItalic: false, points: false, strip: false,
  bars: false, heat: false, clade: false, support: false,
};

function render(clade: Record<string, unknown>, layout: "rectangular" | "circular" = "rectangular") {
  const panel: AlignedPanel = {
    id: "c1", kind: "clade", visible: true,
    options: { clades: [{ id: "k", tips: MEMBERS, color: "#1AA0E6", label: "", ...clade }] },
  };
  const spec = figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: EMPTY_TRACKS, panels: [panel] },
    { width: 700, height: 480 },
  );
  return renderTreeSvg(TREE, spec);
}

describe("Wave 2 clade decoration render", () => {
  it("resolves the MRCA of two real member tips", () => {
    expect(mrca(TREE, MEMBERS)).not.toBeNull();
  });
  it("paints a highlight band (rect, rectangular)", () => {
    expect(render({ style: "highlight" })).toContain('opacity="0.10"');
  });
  it("paints a highlight wedge (circular)", () => {
    expect(render({ style: "highlight" }, "circular")).toContain('opacity="0.12"');
  });
  it("paints a bracket for style=label", () => {
    expect(render({ style: "label" })).toContain('stroke="#1AA0E6"');
  });
  it("collapses to a triangle when collapsed=true", () => {
    expect(render({ collapsed: true })).toContain('opacity="0.45"');
  });
});

describe("clade highlight with a prior empty clade panel (HPV58 restore repro)", () => {
  // The HPV58 demo figure stores tracks.clade=true with no panels[], so opening
  // it projects an EMPTY clade panel; adding a Clade-highlight layer makes two.
  // resolveCladeHighlights/applyCollapses must aggregate ALL clade panels, not
  // just the first, or the populated one never paints.
  it("paints the populated clade even when an empty clade panel precedes it", () => {
    const empty: AlignedPanel = { id: "tracks-clade", kind: "clade", visible: true };
    const populated: AlignedPanel = {
      id: "added", kind: "clade", visible: true,
      options: { clades: [{ id: "k", tips: MEMBERS, color: "#1AA0E6", label: "" }] },
    };
    const spec = figureToRenderSpec(
      TREE,
      { layout: "rectangular", phylogram: true, tracks: EMPTY_TRACKS, panels: [empty, populated] },
      { width: 700, height: 480 },
    );
    expect(renderTreeSvg(TREE, spec)).toContain('opacity="0.10"');
  });
});
