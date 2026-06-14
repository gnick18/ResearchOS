// Wave 4: geom_range. A horizontal bar through each node spanning a parsed
// {lo,hi} annotation interval (e.g. height_95%_HPD), in branch-length / age
// coordinates so it reads against the time axis. Driven by the node annotations
// the parser now captures. Rectangular phylogram only; a tree with no such
// annotation draws nothing.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import { generateGgtreeCode } from "./ggtree-code";
import type { AlignedPanel } from "./types";

// An (ultrametric-ish) timed tree with an HPD interval on the internal node.
const TIMED = parseNewick(
  "((A:1,B:1)[&height_95%_HPD={0.8,1.6}]:1,C:2);",
);
const PLAIN = parseNewick("((A:1,B:1):1,C:2);");

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

const rangePanel: AlignedPanel = {
  id: "nr1",
  kind: "noderange",
  visible: true,
  options: { rangeKey: "height_95%_HPD", color: "#2563EB" },
};

function specFor(tree: typeof TIMED, panels: AlignedPanel[]) {
  return figureToRenderSpec(
    tree,
    { layout: "rectangular", phylogram: true, tracks: NO_TRACKS, panels },
    { width: 500, height: 360 },
  );
}

describe("noderange layer (geom_range)", () => {
  it("draws a colored bar for the annotated node", () => {
    const out = renderTreeSvg(TIMED, specFor(TIMED, [rangePanel]));
    expect(out).toContain("#2563EB");
    expect(out).toMatch(/<rect [^>]*opacity="0.35"/);
  });

  it("draws nothing on a tree without that annotation", () => {
    const out = renderTreeSvg(PLAIN, specFor(PLAIN, [rangePanel]));
    expect(out).not.toContain("#2563EB");
  });

  it("draws nothing on a cladogram (no age coordinate)", () => {
    const spec = figureToRenderSpec(
      TIMED,
      {
        layout: "rectangular",
        phylogram: false,
        tracks: NO_TRACKS,
        panels: [rangePanel],
      },
      { width: 500, height: 360 },
    );
    const out = renderTreeSvg(TIMED, spec);
    expect(out).not.toContain("#2563EB");
  });

  it("exports geom_range naming the interval key", () => {
    const code = generateGgtreeCode(specFor(TIMED, [rangePanel]));
    expect(code).toContain("geom_range(range = 'height_95%_HPD'");
  });

  // Regression (2026-06-14): the bar must be anchored ON its node, not at an
  // absolute-age x. Placing it by absolute age made it float free of the node on
  // any non-ultrametric tree (node depth-from-root != age). With a node point
  // drawn at the node, the node's x must fall inside the range bar.
  it("seats the bar on its node (node point within the bar span)", () => {
    const nodePoints: AlignedPanel = {
      id: "np1",
      kind: "nodepoints",
      visible: true,
      options: { size: 3, color: "#111827" },
    };
    const out = renderTreeSvg(TIMED, specFor(TIMED, [rangePanel, nodePoints]));
    const bar = out.match(
      /<rect x="([\d.]+)"[^>]*width="([\d.]+)"[^>]*opacity="0.35"/,
    );
    const node = out.match(/<circle cx="([\d.]+)"[^>]*fill="#111827"/);
    expect(bar).not.toBeNull();
    expect(node).not.toBeNull();
    const barX = parseFloat(bar![1]);
    const barW = parseFloat(bar![2]);
    const cx = parseFloat(node![1]);
    expect(cx).toBeGreaterThanOrEqual(barX);
    expect(cx).toBeLessThanOrEqual(barX + barW);
  });
});
