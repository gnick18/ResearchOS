// The LINEAR sequence map emits a layout manifest (the collision-advisor seam) and
// the dominant failure it surfaces is content-overflow: features lane-pack upward,
// so a busy plasmid stacks feature rows off the TOP of the canvas. The manifest
// boxes are the exact positions the map drew, so the advisor can detect the clip
// and the shrink-to-fit fix measurably reduces it.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { buildLinearMapManifest, renderSequenceMapSvg } from "./map-render";
import type { SeqDocument, EditFeature } from "./edit-model";
import type { SequenceMapStyle } from "./figure-style";
import { detectCollisions, suggestFixes } from "@/lib/figure/layout-collision";

function doc(features: EditFeature[]): SeqDocument {
  return { name: "pBusy", seq: "A".repeat(4000), seqType: "dna", circular: false, features };
}
// Many heavily-overlapping features -> each needs its own lane -> the rows stack
// upward and the top ones clip off a short canvas.
const dense = doc(
  Array.from({ length: 26 }, (_, i) => ({
    name: `feature_number_${i}`,
    start: 100 + i * 12,
    end: 1400 + i * 12,
    forward: i % 2 === 0,
  })),
);
const sparse = doc([
  { name: "promoter", start: 100, end: 400, forward: true },
  { name: "CDS", start: 600, end: 1800, forward: true },
  { name: "terminator", start: 2000, end: 2200, forward: false },
]);
const SIZE = { width: 620, height: 200 };

describe("linear map layout manifest", () => {
  it("emits a feature mark + label box per visible feature, plus ruler labels", () => {
    const m = buildLinearMapManifest(sparse, SIZE, {});
    expect(m.boxes.filter((b) => b.kind === "mark").length).toBe(3);
    expect(m.boxes.filter((b) => b.id.startsWith("featureLabel:")).length).toBe(3);
    expect(m.boxes.some((b) => b.kind === "axisLabel")).toBe(true);
    expect(m.width).toBe(620);
    expect(m.height).toBe(200);
  });

  it("drops the label boxes when feature labels are hidden", () => {
    const m = buildLinearMapManifest(sparse, SIZE, { showLabels: false });
    expect(m.boxes.some((b) => b.id.startsWith("featureLabel:"))).toBe(false);
    expect(m.boxes.filter((b) => b.kind === "mark").length).toBe(3);
  });

  it("a sparse map does not overflow the canvas", () => {
    const m = buildLinearMapManifest(sparse, SIZE, {});
    expect(detectCollisions(m).some((c) => c.kind === "content-overflow")).toBe(false);
  });
});

describe("content-overflow detection + shrink-to-fit on a busy plasmid", () => {
  it("a dense map stacks feature rows off the top, detected as content-overflow", () => {
    const m = buildLinearMapManifest(dense, SIZE, {});
    expect(m.boxes.some((b) => b.kind === "mark" && b.y < 0)).toBe(true); // rows clipped
    const cols = detectCollisions(m);
    const overflow = cols.find((c) => c.kind === "content-overflow");
    expect(overflow).toBeTruthy();
    const fixes = suggestFixes(cols);
    expect(fixes.some((f) => f.id === "shrink-label-font" && f.available)).toBe(true);
  });

  it("shrinking the feature scale (the wand fix) reduces the overflow", () => {
    const before = buildLinearMapManifest(dense, SIZE, {});
    const after = buildLinearMapManifest(dense, SIZE, { featureScale: 0.6 } as SequenceMapStyle);
    const clip = (m: ReturnType<typeof buildLinearMapManifest>) =>
      m.boxes.filter((b) => b.kind === "mark" && b.y < -4).length;
    expect(clip(after)).toBeLessThan(clip(before));
  });
});

describe("manifest agrees with the rendered ink", () => {
  it("emits one mark per feature arrow the SVG draws", () => {
    const svg = renderSequenceMapSvg(sparse, SIZE, {});
    const arrows = (svg.match(/<path d="M/g) || []).length;
    const marks = buildLinearMapManifest(sparse, SIZE, {}).boxes.filter((b) => b.kind === "mark").length;
    expect(marks).toBe(arrows); // 3 features -> 3 arrows -> 3 mark boxes
  });
});
