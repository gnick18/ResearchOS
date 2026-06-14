// Wave 1B: node / root point glyphs (ggtree geom_nodepoint / geom_rootpoint).
import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import { generateGgtreeCode } from "./ggtree-code";
import type { AlignedPanel } from "./types";

const TREE = parseNewick("((A,B)95,(C,D)80);"); // 3 internal nodes (root + 2)
const EMPTY = { labels:false,labelsItalic:false,points:false,strip:false,bars:false,heat:false,clade:false,support:false };

function spec(opts: Record<string, unknown>, layout: "rectangular" | "circular" = "rectangular") {
  const panel: AlignedPanel = { id: "n", kind: "nodepoints", visible: true, options: opts };
  return figureToRenderSpec(TREE, { layout, phylogram: true, tracks: EMPTY, panels: [panel] }, { width: 700, height: 480 });
}

describe("node / root points", () => {
  it("draws a colored dot at each internal node (rectangular)", () => {
    const svg = renderTreeSvg(TREE, spec({ color: "#1AA0E6" }));
    const dots = (svg.match(/<circle[^>]*fill="#1AA0E6"/g) ?? []).length;
    expect(dots).toBeGreaterThanOrEqual(2); // the two non-root internal nodes at least
  });
  it("omits the root dot unless showRoot is on", () => {
    expect(renderTreeSvg(TREE, spec({}))).not.toContain('stroke="#ffffff" stroke-width="0.75"');
    expect(renderTreeSvg(TREE, spec({ showRoot: true }))).toContain('stroke="#ffffff" stroke-width="0.75"');
  });
  it("works in the circular layout too", () => {
    expect((renderTreeSvg(TREE, spec({ color: "#1AA0E6" }, "circular")).match(/fill="#1AA0E6"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("emits geom_nodepoint in the ggtree code, plus geom_rootpoint with showRoot", () => {
    expect(generateGgtreeCode(spec({}))).toContain("geom_nodepoint");
    expect(generateGgtreeCode(spec({ showRoot: true }))).toContain("geom_rootpoint");
  });
});
