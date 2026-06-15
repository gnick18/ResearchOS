// Wave 3: the slanted layout. Same node positions as the rectangular tree, but
// branches drawn as straight diagonals (parent -> child) instead of right-angle
// elbows. Panels / labels are unchanged (the tip axis stays rectangular), so this
// asserts only the edge geometry differs.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import type { PhyloLayout } from "./types";

const TREE = parseNewick("((A:0.1,B:0.2):0.3,(C:0.15,D:0.25):0.2);");
const NO_TRACKS = {
  labels: false,
  labelsItalic: false,
  points: false,
  strip: false,
  bars: false,
  heat: false,
  clade: false,
  support: false,
};

function specFor(layout: PhyloLayout) {
  return figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: NO_TRACKS, panels: [] },
    { width: 500, height: 360 },
  );
}

describe("slanted layout", () => {
  it("draws straight diagonal edges (L), not the rectangular elbow (V then H)", () => {
    const rect = renderTreeSvg(TREE, specFor("rectangular"));
    const slanted = renderTreeSvg(TREE, specFor("slanted"));
    // The rectangular tree uses an elbow path (vertical then horizontal).
    expect(rect).toMatch(/V[\d.]+ H[\d.]+/);
    // The slanted tree has no elbows, only straight parent-to-child lines.
    expect(slanted).not.toMatch(/V[\d.]+ H[\d.]+/);
    expect(slanted).toMatch(/M[\d.]+ [\d.]+ L[\d.]+ [\d.]+/);
  });

  it("is a valid, closed SVG and not byte-identical to the rectangular tree", () => {
    const rect = renderTreeSvg(TREE, specFor("rectangular"));
    const slanted = renderTreeSvg(TREE, specFor("slanted"));
    expect(slanted.trimEnd().endsWith("</svg>")).toBe(true);
    expect(slanted).not.toBe(rect);
  });
});

describe("rootEdge (Wave 4 geom_rootedge)", () => {
  function specRoot(rootEdge: boolean, layout: PhyloLayout = "rectangular") {
    return figureToRenderSpec(
      TREE,
      { layout, phylogram: true, rootEdge, tracks: NO_TRACKS, panels: [] },
      { width: 500, height: 360 },
    );
  }
  it("draws an extra root stub the default tree lacks (both layouts)", () => {
    expect(renderTreeSvg(TREE, specRoot(true)).length).toBeGreaterThan(
      renderTreeSvg(TREE, specRoot(false)).length,
    );
    expect(
      renderTreeSvg(TREE, specRoot(true, "circular")).length,
    ).toBeGreaterThan(renderTreeSvg(TREE, specRoot(false, "circular")).length);
  });
});
