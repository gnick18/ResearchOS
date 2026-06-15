// Wave 4: the time axis (ggtree theme_tree2). A full-width ruler in age before
// present under a rectangular phylogram, the tips at age 0 and the root at the
// maximum depth, replacing the compact scale bar. Off by default, so a figure
// that never set it is unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import { generateGgtreeCode } from "./ggtree-code";

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

function specFor(opts: { timeAxis?: boolean; phylogram?: boolean }) {
  return figureToRenderSpec(
    TREE,
    {
      layout: "rectangular",
      phylogram: opts.phylogram ?? true,
      timeAxis: opts.timeAxis,
      tracks: NO_TRACKS,
      panels: [],
    },
    { width: 500, height: 360 },
  );
}

describe("time axis (theme_tree2)", () => {
  it("draws a centered tick ruler the scale-bar-only tree lacks", () => {
    const bar = renderTreeSvg(TREE, specFor({ timeAxis: false }));
    const axis = renderTreeSvg(TREE, specFor({ timeAxis: true }));
    expect(axis).not.toBe(bar);
    // The axis ticks are centered text; the compact scale bar label is not.
    expect(axis).toMatch(/text-anchor="middle">0</);
    // More tick marks than the single scale-bar tick.
    expect(axis.length).toBeGreaterThan(bar.length);
  });

  it("does nothing on a cladogram (no branch-length axis)", () => {
    const axis = renderTreeSvg(TREE, specFor({ timeAxis: true, phylogram: false }));
    expect(axis).not.toMatch(/text-anchor="middle">0</);
    expect(axis.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("exports revts + theme_tree2 in the ggtree code", () => {
    const code = generateGgtreeCode(specFor({ timeAxis: true }));
    expect(code).toContain("revts(p)");
    expect(code).toContain("theme_tree2()");
    expect(code).toContain("scale_x_continuous(labels = abs)");
  });

  it("default export still uses geom_treescale (no regression)", () => {
    const code = generateGgtreeCode(specFor({ timeAxis: false }));
    expect(code).toContain("geom_treescale()");
    expect(code).not.toContain("revts");
  });
});
