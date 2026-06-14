// Wave 3: the unrooted (equal-angle) layout. Asserts the algorithm places every
// node inside the box, spreads the leaves (no collapse), and links parents; and
// that the render path draws straight edges (no rectangular elbows) with rotated
// tip labels.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick, allNodes } from "./parse";
import { layoutUnrooted } from "./layout";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import type { AlignedPanel } from "./types";

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

describe("layoutUnrooted (equal-angle)", () => {
  const lo = layoutUnrooted(TREE, {
    width: 400,
    height: 360,
    padding: 20,
    phylogram: true,
  });

  it("places every node, inside the box", () => {
    expect(lo.nodes.length).toBe(allNodes(TREE).length); // root + 2 internal + 4 leaves
    for (const n of lo.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(400);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(360);
    }
  });

  it("spreads the leaves (no collapse to a point) and links parents", () => {
    const leafNodes = lo.nodes.filter((n) => n.node.children.length === 0);
    expect(leafNodes.length).toBe(4);
    // The four tips occupy distinct positions (the equal-angle spread).
    const keys = new Set(
      leafNodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`),
    );
    expect(keys.size).toBe(4);
    // Every node but the root carries its parent's coords (for edge drawing).
    const withParent = lo.nodes.filter((n) => n.parentX !== null);
    expect(withParent.length).toBe(lo.nodes.length - 1);
  });
});

describe("unrooted render", () => {
  function spec(panels: AlignedPanel[]) {
    return figureToRenderSpec(
      TREE,
      { layout: "unrooted", phylogram: true, tracks: NO_TRACKS, panels },
      { width: 400, height: 360 },
    );
  }

  it("draws straight edges (no rectangular elbow) and is a valid SVG", () => {
    const svg = renderTreeSvg(TREE, spec([]));
    expect(svg).not.toMatch(/V[\d.]+ H[\d.]+/);
    expect(svg).toMatch(/L[\d.]+ [\d.]+/);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("draws rotated tip labels when a labels layer is visible", () => {
    const svg = renderTreeSvg(
      TREE,
      spec([{ id: "lbl", kind: "labels", visible: true }]),
    );
    expect(svg).toContain("rotate(");
    expect(svg).toContain(">A<");
  });
});
