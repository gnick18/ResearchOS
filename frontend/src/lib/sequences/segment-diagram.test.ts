import { describe, expect, it } from "vitest";
import { computeSegmentDiagram } from "./segment-diagram";

describe("computeSegmentDiagram", () => {
  it("lays out a single segment spanning the full track", () => {
    const l = computeSegmentDiagram([{ start: 0, end: 100 }], 200, 0);
    expect(l.segmentCount).toBe(1);
    expect(l.segments).toHaveLength(1);
    expect(l.gaps).toHaveLength(0);
    expect(l.spanStart).toBe(0);
    expect(l.spanEnd).toBe(100);
    expect(l.spanBp).toBe(100);
    expect(l.featureBp).toBe(100);
    expect(l.segments[0].x).toBe(0);
    expect(l.segments[0].width).toBe(200);
    expect(l.summary).toBe("100 bp");
  });

  it("produces a gap (intron) between two segments and the SnapGene summary", () => {
    // exon 0..400, intron 400..1000, exon 1000..1129 -> span 1129, feature 529
    const l = computeSegmentDiagram(
      [
        { start: 0, end: 400 },
        { start: 1000, end: 1129 },
      ],
      1129,
      0,
    );
    expect(l.segmentCount).toBe(2);
    expect(l.gaps).toHaveLength(1);
    expect(l.spanBp).toBe(1129);
    expect(l.featureBp).toBe(529);
    expect(l.summary).toBe("1,129 bp / 2 segments = 529 bp");
    // gap sits between the two exons
    expect(l.gaps[0].x).toBeGreaterThan(0);
    expect(l.gaps[0].width).toBeGreaterThan(0);
  });

  it("orders segments positionally regardless of table order, keeping 1-based marker indices", () => {
    const l = computeSegmentDiagram(
      [
        { start: 1000, end: 1129 }, // table row 1
        { start: 0, end: 400 }, // table row 2
      ],
      1000,
      0,
    );
    // first drawn (leftmost) is the 0..400 exon, whose table index is 2
    expect(l.segments[0].start).toBe(0);
    expect(l.segments[0].index).toBe(2);
    expect(l.segments[1].start).toBe(1000);
    expect(l.segments[1].index).toBe(1);
  });

  it("gives a 1bp exon a minimum visible width", () => {
    const l = computeSegmentDiagram(
      [
        { start: 0, end: 1 },
        { start: 999, end: 1000 },
      ],
      1000,
      0,
    );
    expect(l.segments[0].width).toBeGreaterThanOrEqual(4);
  });

  it("respects padding at both ends of the track", () => {
    const l = computeSegmentDiagram([{ start: 0, end: 100 }], 220, 10);
    expect(l.segments[0].x).toBe(10);
    // end maps to width - pad
    expect(l.segments[0].x + l.segments[0].width).toBeCloseTo(210, 5);
  });

  it("handles an empty segment list without throwing", () => {
    const l = computeSegmentDiagram([], 200, 0);
    expect(l.segmentCount).toBe(0);
    expect(l.spanBp).toBe(0);
    expect(l.featureBp).toBe(0);
    expect(l.summary).toBe("0 bp");
  });
});
