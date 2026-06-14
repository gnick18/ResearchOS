// Wave 3: the fan + inward-circular layouts, both circular-family variants.
// Fan spreads tips over a narrower open arc (sweepDegrees); inward-circular keeps
// the circular geometry but mirrors the tip-label orientation to face the center.
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

function specFor(layout: PhyloLayout, panels: AlignedPanel[] = []) {
  return figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: NO_TRACKS, panels },
    { width: 400, height: 360 },
  );
}

describe("fan layout (open-angle circular)", () => {
  function lo(sweepDegrees: number) {
    return layoutCircular(TREE, {
      width: 400,
      height: 360,
      rightInset: 0,
      padding: 16,
      phylogram: true,
      sweepDegrees,
    });
  }
  function leafSpan(layout: ReturnType<typeof lo>) {
    const a = layout.nodes
      .filter((n) => n.node.children.length === 0)
      .map((n) => n.angle);
    return Math.max(...a) - Math.min(...a);
  }

  it("spreads tips over a narrower arc than the near-full circle", () => {
    expect(leafSpan(lo(180))).toBeLessThan(leafSpan(lo(330)));
    expect(leafSpan(lo(180))).toBeCloseTo(Math.PI, 5); // 180 degrees
  });

  it("renders a valid fan figure, distinct from circular", () => {
    const fan = renderTreeSvg(TREE, specFor("fan"));
    const circ = renderTreeSvg(TREE, specFor("circular"));
    expect(fan.trimEnd().endsWith("</svg>")).toBe(true);
    expect(fan).not.toBe(circ);
  });
});

describe("inward-circular layout", () => {
  it("mirrors the tip-label orientation versus outward circular", () => {
    const labels: AlignedPanel[] = [{ id: "lbl", kind: "labels", visible: true }];
    const inward = renderTreeSvg(TREE, specFor("inwardCircular", labels));
    const outward = renderTreeSvg(TREE, specFor("circular", labels));
    // Same tips + positions, but the rotate/anchor on the labels differ.
    expect(inward).toContain("rotate(");
    expect(inward).toContain(">A<");
    expect(inward).not.toBe(outward);
  });
});
