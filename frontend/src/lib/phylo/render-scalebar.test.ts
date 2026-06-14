// Wave 1B: the phylogram scale-bar toggle (geom_treescale on/off).
import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { figureToRenderSpec } from "./figure-to-render";
import { renderTreeSvg } from "./render";

const TREE = parseNewick("((A:0.1,B:0.2):0.3,C:0.4);");
const EMPTY = { labels:false,labelsItalic:false,points:false,strip:false,bars:false,heat:false,clade:false,support:false };

function svg(scaleBar: boolean | undefined) {
  const spec = figureToRenderSpec(TREE, { layout: "rectangular", phylogram: true, scaleBar, tracks: EMPTY, panels: [] }, { width: 700, height: 480 });
  return renderTreeSvg(TREE, spec);
}

describe("scale-bar toggle", () => {
  it("draws the scale bar by default (absent flag = on)", () => {
    expect(svg(undefined)).toContain('x1="16"'); // scale bar starts at x=16
  });
  it("draws it when explicitly on", () => {
    expect(svg(true)).toContain('x1="16"');
  });
  it("hides it when off", () => {
    expect(svg(false)).not.toContain('x1="16"');
  });
});
