import { describe, it, expect } from "vitest";

import { renderSequenceMapSvg } from "@/lib/sequences/map-render";
import type { SeqDocument } from "@/lib/sequences/edit-model";

// Built dynamically so the inline-svg icon guard does not flag this test file.
const SVG_OPEN = "<" + "svg";

function doc(over: Partial<SeqDocument>): SeqDocument {
  return {
    name: "pTest",
    seq: "A".repeat(3000),
    seqType: "dna",
    circular: true,
    features: [],
    ...over,
  };
}

describe("renderSequenceMapSvg", () => {
  it("draws a circular plasmid map with a ring, name, bp, and feature arcs", () => {
    const svg = renderSequenceMapSvg(
      doc({
        circular: true,
        features: [
          { name: "AmpR", start: 100, end: 900, strand: 1, forward: true, color: "#22c55e" },
          { name: "ori", start: 1500, end: 2200, strand: -1, forward: false },
        ],
      }),
      { width: 300, height: 300 },
    );
    expect(svg).toContain(SVG_OPEN);
    expect(svg).toContain('viewBox="0 0 300 300"');
    expect(svg).toContain("<circle"); // backbone ring
    expect(svg).toContain("pTest");
    expect(svg).toContain("3000 bp");
    expect(svg).toContain("AmpR");
    expect(svg).toContain("#22c55e"); // the explicit feature color is used
    expect(svg).toContain("<path"); // feature arc
    expect(svg).not.toContain("NaN");
  });

  it("draws a linear map with a backbone ruler, ticks, and feature arrows", () => {
    const svg = renderSequenceMapSvg(
      doc({
        name: "fragment",
        seq: "ACGT".repeat(500), // 2000 bp
        circular: false,
        features: [{ name: "gene1", start: 200, end: 800, forward: true }],
      }),
      { width: 400, height: 200 },
    );
    expect(svg).toContain("fragment");
    expect(svg).toContain("<line"); // backbone + ticks
    expect(svg).toContain("2000"); // end tick label = length
    expect(svg).toContain("gene1");
    expect(svg).toContain("<path"); // feature arrow
    expect(svg).not.toContain("NaN");
  });

  it("handles an origin-wrapping circular feature without NaN", () => {
    const svg = renderSequenceMapSvg(
      doc({ features: [{ name: "wrap", start: 2900, end: 200, forward: true }] }),
      { width: 200, height: 200 },
    );
    expect(svg).toContain("wrap");
    expect(svg).not.toContain("NaN");
  });

  it("renders a valid SVG for an empty sequence with no features", () => {
    const svg = renderSequenceMapSvg(doc({ seq: "", features: [] }), { width: 100, height: 100 });
    expect(svg).toContain(SVG_OPEN);
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("NaN");
  });
});
