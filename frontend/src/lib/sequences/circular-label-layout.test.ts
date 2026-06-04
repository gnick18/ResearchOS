// label decollide bot — unit tests for the UNIFIED, type-agnostic vertical
// de-collision used by the circular map's outer labels. The crux is that NO TWO
// boxes on the same side overlap regardless of how dense the cluster is, so it
// is tested with hand-built cases, the no-overlap invariant, band clamping, and
// a randomized fuzz over arbitrary inputs (the dense-plasmid case).

import { describe, expect, it } from "vitest";
import {
  deCollideCircularLabels,
  hasCircularOverlap,
  type CircularLabelBox,
  type PlacedCircularLabel,
} from "./circular-label-layout";

/** Re-derive same-side overlap directly (independent of hasCircularOverlap). */
function anyOverlapOnSide(placed: PlacedCircularLabel[]): boolean {
  for (const a of placed) {
    for (const b of placed) {
      if (a === b || a.side !== b.side) continue;
      const aT = a.y - a.height / 2;
      const aB = a.y + a.height / 2;
      const bT = b.y - b.height / 2;
      const bB = b.y + b.height / 2;
      if (aT < bB - 1e-6 && bT < aB - 1e-6) return true;
    }
  }
  return false;
}

const box = (id: string, side: "left" | "right", idealY: number, height = 14): CircularLabelBox => ({
  id,
  side,
  idealY,
  height,
});

describe("deCollideCircularLabels", () => {
  it("returns an empty placement for no boxes", () => {
    expect(deCollideCircularLabels([])).toEqual([]);
  });

  it("leaves a single label at its ideal y", () => {
    const placed = deCollideCircularLabels([box("a", "left", 100)]);
    expect(placed[0].y).toBe(100);
  });

  it("leaves well-separated labels untouched", () => {
    const placed = deCollideCircularLabels([
      box("a", "left", 0),
      box("b", "left", 100),
      box("c", "left", 200),
    ]);
    expect(placed.map(p => p.y)).toEqual([0, 100, 200]);
    expect(hasCircularOverlap(placed)).toBe(false);
  });

  it("pushes two overlapping same-side labels apart (TYPE-AGNOSTIC: a feature + a primer at the same angle)", () => {
    // imagine "Cas9 F1" (a feature) and "Hyg plasmid Sanger R" (a primer) both
    // seeded at y=100 on the left side — the exact screenshot bug.
    const feature = box("feature-Cas9", "left", 100);
    const primer = box("primer-Hyg", "left", 100);
    const placed = deCollideCircularLabels([feature, primer], { gap: 1 });
    expect(hasCircularOverlap(placed)).toBe(false);
    expect(anyOverlapOnSide(placed)).toBe(false);
    // they were both at 100; one must have moved.
    const ys = placed.map(p => p.y).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(14); // height, no gap-undercut
  });

  it("does NOT separate labels on opposite sides even at the same y", () => {
    const placed = deCollideCircularLabels([box("a", "left", 100), box("b", "right", 100)]);
    expect(placed.find(p => p.id === "a")!.y).toBe(100);
    expect(placed.find(p => p.id === "b")!.y).toBe(100);
  });

  it("stacks a dense cluster with no overlap", () => {
    const items = Array.from({ length: 12 }, (_, i) => box(`x${i}`, "left", 100 + (i % 3)));
    const placed = deCollideCircularLabels(items, { gap: 1 });
    expect(hasCircularOverlap(placed)).toBe(false);
  });

  it("relaxes a cluster upward when it overruns maxY rather than clipping", () => {
    // 5 boxes all seeded near the bottom edge; with maxY they must spread up.
    const items = Array.from({ length: 5 }, (_, i) => box(`b${i}`, "right", 195 + i));
    const placed = deCollideCircularLabels(items, { gap: 1, minY: 0, maxY: 200 });
    expect(hasCircularOverlap(placed)).toBe(false);
    for (const p of placed) {
      expect(p.y + p.height / 2).toBeLessThanOrEqual(200 + 1e-6);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0 - 1e-6);
    }
  });

  it("preserves input order in the returned array", () => {
    const placed = deCollideCircularLabels([box("z", "left", 50), box("a", "left", 50)]);
    expect(placed.map(p => p.id)).toEqual(["z", "a"]);
  });

  it("fuzz: no two same-side boxes ever overlap for arbitrary dense inputs", () => {
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 60);
      const items: CircularLabelBox[] = Array.from({ length: n }, (_, i) => ({
        id: `i${i}`,
        side: rand() < 0.5 ? "left" : "right",
        idealY: rand() * 400,
        height: 12 + Math.floor(rand() * 6),
      }));
      const placed = deCollideCircularLabels(items, { gap: 1, minY: 0, maxY: 400 });
      expect(hasCircularOverlap(placed)).toBe(false);
      expect(anyOverlapOnSide(placed)).toBe(false);
    }
  });
});
