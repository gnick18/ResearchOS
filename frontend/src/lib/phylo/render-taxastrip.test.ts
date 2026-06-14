// Wave 4: geom_strip. A solid bar drawn just outside the tips spanning the range
// from one named tip to another (any contiguous range, not necessarily a clade),
// with an optional label. Stored by tip NAME on the taxastrip layer's
// options.strips seam, so a figure with no such layer is unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import { generateGgtreeCode } from "./ggtree-code";
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

const stripPanel: AlignedPanel = {
  id: "ts1",
  kind: "taxastrip",
  visible: true,
  options: {
    strips: [{ id: "s1", from: "A", to: "B", color: "#1D9E75", label: "Clade I" }],
  },
};

function specFor(layout: PhyloLayout, panels: AlignedPanel[]) {
  return figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: NO_TRACKS, panels },
    { width: 500, height: 360 },
  );
}

describe("taxastrip layer (geom_strip)", () => {
  it("adds a span bar + label the bare tree lacks (rectangular)", () => {
    const bare = renderTreeSvg(TREE, specFor("rectangular", []));
    const striped = renderTreeSvg(TREE, specFor("rectangular", [stripPanel]));
    expect(striped.length).toBeGreaterThan(bare.length);
    expect(striped).toContain("#1D9E75");
    expect(striped).toContain("Clade I");
    expect(bare).not.toContain("Clade I");
  });

  it("also draws the span in the circular layout", () => {
    const striped = renderTreeSvg(TREE, specFor("circular", [stripPanel]));
    expect(striped).toContain("#1D9E75");
    expect(striped).toContain("Clade I");
  });

  it("a hidden strip layer draws nothing", () => {
    const hidden = { ...stripPanel, visible: false };
    const out = renderTreeSvg(TREE, specFor("rectangular", [hidden]));
    expect(out).not.toContain("Clade I");
  });

  it("a strip naming an unknown tip is skipped, not crashed", () => {
    const bad: AlignedPanel = {
      ...stripPanel,
      options: {
        strips: [{ id: "s1", from: "A", to: "ZZZ", color: "#1D9E75", label: "X" }],
      },
    };
    const out = renderTreeSvg(TREE, specFor("rectangular", [bad]));
    expect(out.trimEnd().endsWith("</svg>")).toBe(true);
    expect(out).not.toContain(">X<");
  });

  it("exports a geom_strip call naming both tips + the label", () => {
    const code = generateGgtreeCode(specFor("rectangular", [stripPanel]));
    expect(code).toContain("geom_strip");
    expect(code).toContain("'A', 'B'");
    expect(code).toContain("label = 'Clade I'");
  });
});
