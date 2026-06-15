import { describe, expect, it } from "vitest";
import {
  createFigurePage,
  type Annotation,
  type FigurePage,
  type FigurePanel,
  type PlacedAsset,
} from "@/lib/figure/figure-page";
import {
  alignElements,
  bringToFront,
  computeSnap,
  distributeElements,
  elementBox,
  elementsInRect,
  listElements,
  refKey,
  sendToBack,
  unionBox,
  type ElementRef,
} from "@/lib/figure/figure-arrange";

function panel(id: string, xIn: number, yIn: number, wIn = 1, hIn = 1): FigurePanel {
  return { panelId: id, ref: { type: "seq", id: "s1" }, xIn, yIn, wIn, hIn };
}
function asset(id: string, xIn: number, yIn: number, wIn = 0.5, hIn = 0.5): PlacedAsset {
  return {
    assetId: id,
    ref: { source: "bioicons", sourceId: "x" },
    svgPath: "a.svg",
    xIn,
    yIn,
    wIn,
    hIn,
    credit: "c",
    requiresAttribution: false,
  };
}
function textAnn(id: string, xIn: number, yIn: number): Annotation {
  return { annId: id, kind: "text", xIn, yIn, text: "hi", fontPt: 12 };
}

function pageWith(
  panels: FigurePanel[] = [],
  assets: PlacedAsset[] = [],
  annotations: Annotation[] = [],
): FigurePage {
  return { ...createFigurePage("p1", "P", null), panels, assets, annotations };
}

const pRef = (id: string): ElementRef => ({ kind: "panel", id });

describe("element model + boxes", () => {
  it("lists every element kind in render order", () => {
    const page = pageWith([panel("a", 0, 0)], [asset("b", 1, 1)], [textAnn("c", 2, 2)]);
    expect(listElements(page).map(refKey)).toEqual(["panel:a", "asset:b", "annotation:c"]);
  });

  it("reads panel + asset boxes directly", () => {
    const page = pageWith([panel("a", 1, 2, 3, 4)], [asset("b", 5, 6, 0.5, 0.5)]);
    expect(elementBox(page, pRef("a"))).toEqual({ xIn: 1, yIn: 2, wIn: 3, hIn: 4 });
    expect(elementBox(page, { kind: "asset", id: "b" })).toEqual({ xIn: 5, yIn: 6, wIn: 0.5, hIn: 0.5 });
  });

  it("returns null for a stale ref", () => {
    expect(elementBox(pageWith(), pRef("nope"))).toBeNull();
  });

  it("computes the union box across kinds", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1)], [asset("b", 3, 3, 1, 1)]);
    expect(unionBox(page, [pRef("a"), { kind: "asset", id: "b" }])).toEqual({
      xIn: 0,
      yIn: 0,
      wIn: 4,
      hIn: 4,
    });
  });
});

describe("align", () => {
  it("aligns left edges to the selection bounding box", () => {
    const page = pageWith([panel("a", 1, 0), panel("b", 5, 0), panel("c", 3, 0)]);
    const out = alignElements(page, [pRef("a"), pRef("b"), pRef("c")], "left");
    expect(out.panels.map((p) => p.xIn)).toEqual([1, 1, 1]);
  });

  it("aligns right edges (accounts for differing widths)", () => {
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("b", 0, 2, 3, 1)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "right");
    // selection right edge = 3; a (w1) -> x=2, b (w3) -> x=0
    expect(out.panels.map((p) => p.xIn)).toEqual([2, 0]);
  });

  it("centers horizontally", () => {
    const page = pageWith([panel("a", 0, 0, 2, 1), panel("b", 0, 2, 4, 1)]);
    const out = alignElements(page, [pRef("a"), pRef("b")], "centerX");
    // union center x = 2; a -> 1, b -> 0
    expect(out.panels.map((p) => p.xIn)).toEqual([1, 0]);
  });

  it("is a no-op for a single element", () => {
    const page = pageWith([panel("a", 1, 1)]);
    expect(alignElements(page, [pRef("a")], "left")).toBe(page);
  });
});

describe("distribute", () => {
  it("equalizes horizontal gaps for 3 elements", () => {
    // widths all 1; leftmost x=0, rightmost x=9 -> span 10, total width 3, gap=(10-3)/2=3.5
    const page = pageWith([panel("a", 0, 0, 1, 1), panel("m", 2, 0, 1, 1), panel("z", 9, 0, 1, 1)]);
    const out = distributeElements(page, [pRef("a"), pRef("m"), pRef("z")], "horizontal");
    const byId = Object.fromEntries(out.panels.map((p) => [p.panelId, p.xIn]));
    expect(byId.a).toBeCloseTo(0);
    expect(byId.m).toBeCloseTo(4.5); // 0 + 1 + 3.5
    expect(byId.z).toBeCloseTo(9); // endpoints fixed
  });

  it("needs at least 3 elements", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 5, 0)]);
    expect(distributeElements(page, [pRef("a"), pRef("b")], "horizontal")).toBe(page);
  });
});

describe("smart-guide snap", () => {
  it("snaps a left edge to another element's left edge within threshold", () => {
    // mover is wide (w=3) so only its LEFT edge falls near a target -> deterministic.
    const page = pageWith([panel("anchor", 2, 0, 1, 1), panel("mover", 0, 5, 3, 1)]);
    const r = computeSnap(page, pRef("mover"), { xIn: 2.03, yIn: 5, wIn: 3, hIn: 1 });
    expect(r.dxIn).toBeCloseTo(-0.03);
    expect(r.guides.some((g) => g.axis === "x" && Math.abs(g.atIn - 2) < 1e-9)).toBe(true);
  });

  it("does not snap beyond threshold", () => {
    const page = pageWith([panel("anchor", 2, 0, 1, 1), panel("mover", 0, 5, 1, 1)]);
    // x=2.7: lines 2.7/3.2/3.7 vs targets 2/2.5/3 -> nearest 0.2 in, beyond 0.05
    const r = computeSnap(page, pRef("mover"), { xIn: 2.7, yIn: 5, wIn: 1, hIn: 1 }, { thresholdIn: 0.05 });
    expect(r.dxIn).toBe(0);
    expect(r.guides.filter((g) => g.axis === "x")).toHaveLength(0);
  });

  it("snaps center to the page center", () => {
    const page = pageWith([panel("mover", 0, 0, 2, 1)]);
    // page 10 wide -> center 5; mover center at x=4.98 -> snap +0.02
    const r = computeSnap(page, pRef("mover"), { xIn: 3.98, yIn: 0, wIn: 2, hIn: 1 }, { pageWIn: 10 });
    expect(r.dxIn).toBeCloseTo(0.02);
  });
});

describe("z-order", () => {
  it("brings an element to the front of its layer", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 0, 0), panel("c", 0, 0)]);
    expect(bringToFront(page, pRef("a")).panels.map((p) => p.panelId)).toEqual(["b", "c", "a"]);
  });
  it("sends an element to the back of its layer", () => {
    const page = pageWith([panel("a", 0, 0), panel("b", 0, 0), panel("c", 0, 0)]);
    expect(sendToBack(page, pRef("c")).panels.map((p) => p.panelId)).toEqual(["c", "a", "b"]);
  });
});

describe("marquee select", () => {
  it("returns elements whose box intersects the rectangle", () => {
    const page = pageWith([panel("in", 1, 1, 1, 1), panel("out", 9, 9, 1, 1)]);
    const hits = elementsInRect(page, { xIn: 0, yIn: 0, wIn: 3, hIn: 3 }).map(refKey);
    expect(hits).toEqual(["panel:in"]);
  });
});
