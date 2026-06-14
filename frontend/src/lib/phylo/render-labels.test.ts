// Wave 1B: tip-label alignment leader lines (geom_tiplab align=TRUE) + the
// ragged (align=false) option, both layouts driven through renderTreeSvg.
import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";
import type { AlignedPanel } from "./types";

// A phylogram with very uneven branch lengths => ragged tip x => real leader gap.
const TREE = parseNewick("((A:0.1,B:0.9):0.1,(C:0.2,D:0.8):0.1);");
const EMPTY = { labels:false,labelsItalic:false,points:false,strip:false,bars:false,heat:false,clade:false,support:false };

function svg(opts: Record<string, unknown>, layout: "rectangular" | "circular" = "rectangular") {
  const labels: AlignedPanel = { id: "l", kind: "labels", visible: true, options: opts };
  const spec = figureToRenderSpec(
    TREE,
    { layout, phylogram: true, tracks: EMPTY, panels: [labels] },
    { width: 700, height: 480 },
  );
  return renderTreeSvg(TREE, spec);
}

describe("tip-label alignment leader lines", () => {
  it("draws dotted leaders when aligned (default) on a ragged phylogram", () => {
    expect(svg({})).toContain('stroke-dasharray="1 2"');
  });
  it("draws NO leaders when align is off (ragged labels)", () => {
    expect(svg({ align: false })).not.toContain('stroke-dasharray="1 2"');
  });
  it("supports aligned leaders in the circular layout too", () => {
    expect(svg({}, "circular")).toContain('stroke-dasharray="1 2"');
  });
});
