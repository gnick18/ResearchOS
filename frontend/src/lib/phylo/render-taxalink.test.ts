// Wave 4: geom_taxalink. A curve drawn between two named tips, bowing right in
// the rectangular tree and through the inside of a circular one. Links are stored
// by tip NAME on the taxalink layer's options.links seam, so a figure with no
// such layer is unchanged.
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

const linkPanel: AlignedPanel = {
  id: "tl1",
  kind: "taxalink",
  visible: true,
  options: { links: [{ id: "l1", from: "A", to: "D", color: "#7C3AED" }] },
};

function specFor(layout: PhyloLayout, panels: AlignedPanel[]) {
  return figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: NO_TRACKS, panels },
    { width: 500, height: 360 },
  );
}

describe("taxalink layer (geom_taxalink)", () => {
  it("adds a dashed quadratic curve the bare tree lacks (rectangular)", () => {
    const bare = renderTreeSvg(TREE, specFor("rectangular", []));
    const linked = renderTreeSvg(TREE, specFor("rectangular", [linkPanel]));
    expect(bare).not.toMatch(/stroke-dasharray="4 3"/);
    // A Q (quadratic) path carrying the link color + dash style.
    expect(linked).toMatch(/<path d="M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+/);
    expect(linked).toContain("#7C3AED");
    expect(linked).toMatch(/stroke-dasharray="4 3"/);
  });

  it("also draws the curve in the circular layout", () => {
    const linked = renderTreeSvg(TREE, specFor("circular", [linkPanel]));
    expect(linked).toMatch(/<path d="M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+/);
    expect(linked).toContain("#7C3AED");
  });

  it("a hidden taxalink layer draws nothing", () => {
    const hidden = { ...linkPanel, visible: false };
    const out = renderTreeSvg(TREE, specFor("rectangular", [hidden]));
    expect(out).not.toMatch(/stroke-dasharray="4 3"/);
  });

  it("a link naming an unknown tip is skipped, not crashed", () => {
    const bad: AlignedPanel = {
      ...linkPanel,
      options: { links: [{ id: "l1", from: "A", to: "ZZZ", color: "#7C3AED" }] },
    };
    const out = renderTreeSvg(TREE, specFor("rectangular", [bad]));
    expect(out.trimEnd().endsWith("</svg>")).toBe(true);
    expect(out).not.toMatch(/stroke-dasharray="4 3"/);
  });

  it("exports a geom_taxalink call naming both tips", () => {
    const code = generateGgtreeCode(specFor("rectangular", [linkPanel]));
    expect(code).toContain("geom_taxalink");
    expect(code).toContain("taxa1 = 'A'");
    expect(code).toContain("taxa2 = 'D'");
  });
});
