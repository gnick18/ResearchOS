import { describe, it, expect } from "vitest";

import {
  createFigurePage,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  moveAnnotation,
  makeTextAnnotation,
  makeArrowAnnotation,
  makeBracketAnnotation,
} from "@/lib/figure/figure-page";
import { annotationToSvg, annotationDefs } from "@/lib/figure/figure-compose";

function page() {
  return createFigurePage("f", "F", null);
}

describe("annotation model", () => {
  it("adds the three annotation kinds with sane defaults", () => {
    let p = page();
    p = addAnnotation(p, makeTextAnnotation("t1", 1, 2));
    p = addAnnotation(p, makeArrowAnnotation("a1", 1, 1));
    p = addAnnotation(p, makeBracketAnnotation("b1", 2, 3));
    expect(p.annotations).toHaveLength(3);
    const [t, a, b] = p.annotations;
    expect(t).toMatchObject({ kind: "text", xIn: 1, yIn: 2, text: "Text" });
    expect(a).toMatchObject({ kind: "arrow", x1In: 1, x2In: 2.2, heads: 1 });
    expect(b).toMatchObject({ kind: "bracket", spanIn: 1.5, orientation: "horizontal" });
  });

  it("updates an annotation by id (kind-specific fields)", () => {
    let p = addAnnotation(page(), makeArrowAnnotation("a1", 0, 0));
    p = updateAnnotation(p, "a1", { heads: 2 });
    expect(p.annotations[0]).toMatchObject({ kind: "arrow", heads: 2 });
    let q = addAnnotation(page(), makeBracketAnnotation("b1", 0, 0));
    q = updateAnnotation(q, "b1", { label: "**", orientation: "vertical" });
    expect(q.annotations[0]).toMatchObject({ label: "**", orientation: "vertical" });
  });

  it("removes an annotation by id", () => {
    let p = addAnnotation(page(), makeTextAnnotation("t1", 1, 1));
    p = removeAnnotation(p, "t1");
    expect(p.annotations).toHaveLength(0);
  });

  it("moves a text annotation and both arrow endpoints, clamped at 0", () => {
    let p = addAnnotation(page(), makeTextAnnotation("t1", 2, 2));
    p = moveAnnotation(p, "t1", 1, -3); // y would go negative -> clamp 0
    expect(p.annotations[0]).toMatchObject({ xIn: 3, yIn: 0 });

    let q = addAnnotation(page(), makeArrowAnnotation("a1", 2, 2)); // x1=2,x2=3.2
    q = moveAnnotation(q, "a1", 1, 1);
    expect(q.annotations[0]).toMatchObject({ x1In: 3, y1In: 3, x2In: 4.2, y2In: 3 });
  });
});

describe("annotationToSvg (shared on-screen + export renderer)", () => {
  it("emits the arrowhead marker defs", () => {
    expect(annotationDefs()).toContain("fp-ah");
    expect(annotationDefs()).toContain("marker");
  });

  it("draws text with its content escaped", () => {
    const svg = annotationToSvg(makeTextAnnotation("t1", 1, 1), 96);
    expect(svg).toContain("<text");
    expect(svg).toContain(">Text</text>");
  });

  it("toggles arrow heads via markers", () => {
    const line = annotationToSvg({ annId: "a", kind: "arrow", x1In: 0, y1In: 0, x2In: 1, y2In: 0, heads: 0 }, 96);
    expect(line).not.toContain("marker-end");
    const one = annotationToSvg({ annId: "a", kind: "arrow", x1In: 0, y1In: 0, x2In: 1, y2In: 0, heads: 1 }, 96);
    expect(one).toContain("marker-end");
    expect(one).not.toContain("marker-start");
    const two = annotationToSvg({ annId: "a", kind: "arrow", x1In: 0, y1In: 0, x2In: 1, y2In: 0, heads: 2 }, 96);
    expect(two).toContain("marker-start");
  });

  it("draws a bracket with its significance label", () => {
    const svg = annotationToSvg(
      { annId: "b", kind: "bracket", xIn: 1, yIn: 1, spanIn: 2, orientation: "horizontal", label: "**" },
      96,
    );
    expect(svg).toContain("<path");
    expect(svg).toContain(">**</text>");
  });
});
