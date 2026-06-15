import { describe, expect, it } from "vitest";
import { makeTextAnnotation, TEXT_VARIANT_PT } from "@/lib/figure/figure-page";
import { annotationToSvg } from "@/lib/figure/figure-compose";

describe("typed text variants", () => {
  it("makeTextAnnotation defaults to label and sets the preset size", () => {
    const a = makeTextAnnotation("t1", 1, 1);
    expect(a).toMatchObject({ kind: "text", variant: "label", fontPt: TEXT_VARIANT_PT.label });
  });

  it("each variant carries its preset point size", () => {
    const h = makeTextAnnotation("t", 0, 0, "heading");
    const b = makeTextAnnotation("t", 0, 0, "body");
    expect(h.kind === "text" ? h.fontPt : 0).toBe(18);
    expect(b.kind === "text" ? b.fontPt : 0).toBe(10);
  });

  it("renders the variant's font-weight (heading bold, body normal)", () => {
    expect(annotationToSvg(makeTextAnnotation("t", 0, 0, "heading"), 72)).toContain('font-weight="700"');
    expect(annotationToSvg(makeTextAnnotation("t", 0, 0, "body"), 72)).toContain('font-weight="400"');
  });

  it("legacy text with no variant renders as a label weight", () => {
    const legacy = { annId: "t", kind: "text" as const, xIn: 0, yIn: 0, text: "x", fontPt: 12 };
    expect(annotationToSvg(legacy, 72)).toContain('font-weight="600"');
  });
});
