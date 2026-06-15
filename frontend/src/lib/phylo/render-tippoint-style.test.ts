// Wave 1B: tip points sized + shaped by a metadata column (ggtree
// aes(size = ..., shape = ...)). A numeric column scales the marker radius; a
// categorical column maps each distinct value to a marker shape (circle, square,
// triangle, diamond). Absent options keep the fixed default circle, so a points
// layer with no styling reads exactly as before.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import { generateGgtreeCode } from "./ggtree-code";
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
const ROWS = [
  { name: "A", mass: "1", group: "x" },
  { name: "B", mass: "10", group: "y" },
  { name: "C", mass: "5", group: "x" },
  { name: "D", mass: "2", group: "z" },
];

function specFor(options: Record<string, unknown>) {
  const panel: AlignedPanel = {
    id: "pt",
    kind: "points",
    visible: true,
    options,
  };
  return figureToRenderSpec(
    TREE,
    {
      layout: "rectangular",
      phylogram: true,
      tracks: NO_TRACKS,
      panels: [panel],
      metaRows: ROWS,
      tipColumn: "name",
    },
    { width: 500, height: 360 },
  );
}

describe("tip point size + shape by column", () => {
  it("plain points are fixed-radius circles", () => {
    const out = renderTreeSvg(TREE, specFor({}));
    expect(out).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="4(\.00)?"/);
    // No shape-marker paths (the only <path> are tree branches, which use V/H).
    expect(out).not.toMatch(/<path d="M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ L/);
  });

  it("size-by-column produces a range of radii, not one fixed value", () => {
    const out = renderTreeSvg(TREE, specFor({ sizeColumn: "mass" }));
    const radii = [...out.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    const uniq = new Set(radii.map((r) => r.toFixed(2)));
    expect(uniq.size).toBeGreaterThan(1);
  });

  it("shape-by-column emits more than one marker type", () => {
    const out = renderTreeSvg(TREE, specFor({ shapeColumn: "group" }));
    // group has 3 distinct values -> circle + two of square/triangle/diamond.
    const usesNonCircle = /<rect|<path d="M[\d.]+ [\d.]+ L/.test(out);
    expect(usesNonCircle).toBe(true);
  });

  it("exports aes(size, shape) in the ggtree code", () => {
    const code = generateGgtreeCode(specFor({ sizeColumn: "mass", shapeColumn: "group" }));
    expect(code).toContain("geom_tippoint(aes(");
    expect(code).toContain("size = mass");
    expect(code).toContain("shape = group");
  });
});
