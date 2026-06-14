import { describe, it, expect } from "vitest";
import { parseNewick, leaves } from "./parse";
import { layoutRectangular, layoutCircular, rectTipAxis, circularTipAxis, type LayoutOptions } from "./layout";
import { tipAxisToAlignedAxis } from "./datahub-panel";

const OPTS: LayoutOptions = { width: 560, height: 420, rightInset: 120, padding: 16, phylogram: true };

describe("tipAxisToAlignedAxis", () => {
  const tree = parseNewick("((A:0.1,B:0.1):0.2,(C:0.1,D:0.1):0.2);");
  const axis = rectTipAxis(tree, layoutRectangular(tree, OPTS));

  it("emits tip names in tree order", () => {
    expect(tipAxisToAlignedAxis(axis).order).toEqual(leaves(tree).map((t) => t.name));
  });

  it("emits each tip's y center as its position, and the band thickness", () => {
    const out = tipAxisToAlignedAxis(axis);
    expect(out.positions).toEqual(axis.tips.map((t) => t.y));
    expect(out.band).toBe(axis.bandHeight);
    expect(out.positions).toHaveLength(out.order.length);
  });

  it("throws on a circular axis (v1 rectangular only)", () => {
    const cAxis = circularTipAxis(tree, layoutCircular(tree, OPTS));
    expect(() => tipAxisToAlignedAxis(cAxis)).toThrow(/rectangular only/);
  });
});
