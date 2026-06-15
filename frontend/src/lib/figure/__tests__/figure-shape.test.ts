import { describe, expect, it } from "vitest";
import {
  addShape,
  createFigurePage,
  makeShape,
  pageShapes,
  removeShape,
  updateShape,
  type FigurePage,
} from "@/lib/figure/figure-page";
import { elementBox, listElements } from "@/lib/figure/figure-arrange";
import { shapesToSvg } from "@/lib/figure/figure-compose";

function page(): FigurePage {
  return createFigurePage("p", "P", null);
}

describe("shape model", () => {
  it("adds / reads / removes shapes", () => {
    let p = page();
    p = addShape(p, makeShape("s1", "rect", 1, 2));
    expect(pageShapes(p)).toHaveLength(1);
    p = removeShape(p, "s1");
    expect(pageShapes(p)).toHaveLength(0);
  });

  it("updates fill / stroke without touching the kind", () => {
    let p = addShape(page(), makeShape("s1", "ellipse", 0, 0));
    p = updateShape(p, "s1", { fill: "#fff", stroke: "none" });
    const s = pageShapes(p)[0];
    expect(s.fill).toBe("#fff");
    expect(s.stroke).toBe("none");
    expect(s.kind).toBe("ellipse");
  });
});

describe("shapes are first-class elements", () => {
  it("appear in listElements + have a box (so select/align/z-order work)", () => {
    const p = addShape(page(), makeShape("s1", "rect", 1, 2));
    expect(listElements(p).some((r) => r.kind === "shape" && r.id === "s1")).toBe(true);
    expect(elementBox(p, { kind: "shape", id: "s1" })).toMatchObject({ xIn: 1, yIn: 2 });
  });
});

describe("shapesToSvg export", () => {
  it("renders a rect and an ellipse", () => {
    let p = addShape(page(), makeShape("r", "rect", 0, 0));
    p = addShape(p, makeShape("e", "ellipse", 1, 1));
    const svg = shapesToSvg(p, 96);
    expect(svg).toContain("<rect");
    expect(svg).toContain("<ellipse");
  });

  it("emits fill=none when the fill is cleared", () => {
    const p = addShape(page(), updateShapeFill(makeShape("r", "rect", 0, 0)));
    expect(shapesToSvg(p, 96)).toContain('fill="none"');
  });
});

function updateShapeFill(s: ReturnType<typeof makeShape>) {
  return { ...s, fill: "none" };
}
