// Circular right-gutter callouts (Grant's "circle left, callouts right" look). A
// rooted circular layout, given a wider-than-tall canvas, left-anchors the circle
// in a height-sized square and pulls each ring's track name out into the right
// margin with a thin leader, so the rings self-identify without the side legend.
// The behavior is inert (byte-identical) for a square / portrait canvas, so every
// other circular caller is unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { layoutCircular } from "./layout";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import type { AlignedPanel, PhyloLayout } from "./types";

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
const META = [
  { name: "A", Region: "East" },
  { name: "B", Region: "West" },
  { name: "C", Region: "East" },
  { name: "D", Region: "West" },
];
const stripPanel: AlignedPanel = {
  id: "strip1",
  kind: "strip",
  visible: true,
  column: "Region",
};

function spec(width: number, height: number, layout: PhyloLayout = "circular") {
  return figureToRenderSpec(
    TREE,
    {
      layout,
      phylogram: true,
      tracks: NO_TRACKS,
      panels: [stripPanel],
      metaRows: META,
      tipColumn: "name",
      categoryColumn: "Region",
    },
    { width, height },
  );
}

describe("circular gutter layout (circle left-anchored)", () => {
  function lay(width: number, height: number, circularGutter: boolean) {
    return layoutCircular(TREE, {
      width,
      height,
      rightInset: 0,
      padding: 16,
      phylogram: true,
      circularGutter,
    });
  }

  it("left-anchors the circle to a height-sized square when widened + opted in", () => {
    const wide = lay(840, 620, true);
    expect(wide.cx).toBe(310); // height / 2, not width / 2 (which would be 420)
  });

  it("keeps the radius height-bound, so widening costs the tree no radius", () => {
    const square = lay(620, 620, true);
    const wide = lay(840, 620, true);
    // Same height, so the same radius -- the gutter is pure extra width.
    expect(wide.radius).toBe(square.radius);
  });

  it("is inert for a square canvas (cx unchanged) even when opted in", () => {
    const square = lay(620, 620, true);
    expect(square.cx).toBe(310); // width / 2 == height / 2, identical to old
  });

  it("is inert when not opted in, even on a wide canvas (stays centered)", () => {
    const wide = lay(840, 620, false);
    expect(wide.cx).toBe(420); // width / 2 -- the old centered behavior
  });
});

describe("circular gutter callouts (pulled-out track names)", () => {
  it("emits a leader + the track name in the gutter on a widened circular figure", () => {
    const svg = renderTreeSvg(TREE, spec(840, 620));
    expect(svg).toContain("Region"); // the ring's track name
    expect(svg).toContain('stroke-width="0.75"'); // the thin leader
    expect(svg).toContain('font-size="9.5"'); // the callout label
  });

  it("does not draw callouts on a square circular figure (gutter inert)", () => {
    const svg = renderTreeSvg(TREE, spec(620, 620));
    // The square figure still labels the ring (the top-stacked panelTitle), but
    // not via the pulled-out callout path (no 9.5px leader-labels).
    expect(svg).not.toContain('font-size="9.5"');
  });

  it("does not draw callouts on a rectangular figure", () => {
    const svg = renderTreeSvg(TREE, spec(840, 620, "rectangular"));
    expect(svg).not.toContain('font-size="9.5"');
  });

  it("also draws callouts for the fan + inward-circular radial layouts", () => {
    for (const layout of ["fan", "inwardCircular"] as const) {
      const svg = renderTreeSvg(TREE, spec(840, 620, layout));
      expect(svg).toContain("Region"); // the ring's track name
      expect(svg).toContain('stroke-width="0.75"'); // the leader
      expect(svg).toContain('font-size="9.5"'); // the callout label
    }
  });
});
