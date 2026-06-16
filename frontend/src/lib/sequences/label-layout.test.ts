// linear map bot — unit tests for the LABEL PACKING used by the linear map's
// above-line (enzyme / primer) and below-line (feature) labels. The no-overlap
// guarantee is the crux of the map looking right, so it is tested exhaustively:
// hand-built cases, the within-tier overlap invariant, tiering when nudging is
// disallowed, track-bound clamping, and a randomized fuzz that asserts the
// invariant holds for arbitrary inputs.

import { describe, expect, it } from "vitest";
import {
  layoutLabels,
  tierCount,
  hasTierOverlap,
  cutSiteStackTooDeep,
  CUT_SITE_TIER_LIMIT,
  type LabelItem,
  type PlacedLabel,
} from "./label-layout";

/** Re-derive overlap directly (independent of hasTierOverlap) for cross-check. */
function anyOverlapWithinTier(placed: PlacedLabel[]): boolean {
  for (const a of placed) {
    for (const b of placed) {
      if (a === b || a.tier !== b.tier) continue;
      const aL = a.labelX - a.width / 2;
      const aR = a.labelX + a.width / 2;
      const bL = b.labelX - b.width / 2;
      const bR = b.labelX + b.width / 2;
      if (aL < bR - 1e-6 && bL < aR - 1e-6) return true;
    }
  }
  return false;
}

describe("cutSiteStackTooDeep (interactive crowding advisory)", () => {
  it("flags a stack only once it reaches the tier limit", () => {
    expect(cutSiteStackTooDeep(CUT_SITE_TIER_LIMIT - 1)).toBe(false);
    expect(cutSiteStackTooDeep(CUT_SITE_TIER_LIMIT)).toBe(true);
    expect(cutSiteStackTooDeep(CUT_SITE_TIER_LIMIT + 4)).toBe(true);
  });
  it("does not flag an empty / shallow map", () => {
    expect(cutSiteStackTooDeep(0)).toBe(false);
    expect(cutSiteStackTooDeep(1)).toBe(false);
  });
});

describe("layoutLabels", () => {
  it("returns an empty placement for no items", () => {
    expect(layoutLabels([])).toEqual([]);
    expect(tierCount(layoutLabels([]))).toBe(0);
  });

  it("places a single label at its anchor in tier 0", () => {
    const placed = layoutLabels([{ id: "a", anchorX: 100, width: 40 }]);
    expect(placed).toHaveLength(1);
    expect(placed[0].tier).toBe(0);
    expect(placed[0].labelX).toBe(100);
  });

  it("keeps well-separated labels all in tier 0 at their anchors", () => {
    const items: LabelItem[] = [
      { id: "a", anchorX: 0, width: 20 },
      { id: "b", anchorX: 200, width: 20 },
      { id: "c", anchorX: 400, width: 20 },
    ];
    const placed = layoutLabels(items);
    expect(placed.every((p) => p.tier === 0)).toBe(true);
    expect(hasTierOverlap(placed)).toBe(false);
  });

  it("nudges overlapping labels apart within tier 0 when nudging is allowed", () => {
    // Two labels at the same anchor, width 40 each: they cannot both sit at 100.
    const items: LabelItem[] = [
      { id: "a", anchorX: 100, width: 40 },
      { id: "b", anchorX: 100, width: 40 },
    ];
    const placed = layoutLabels(items, { gap: 4 });
    expect(hasTierOverlap(placed)).toBe(false);
    // Default maxNudge is huge => they stay in tier 0, shoved apart.
    expect(placed.every((p) => p.tier === 0)).toBe(true);
  });

  it("STACKS overlapping labels into higher tiers when nudging is forbidden", () => {
    // maxNudge 0 => a label must sit exactly on its anchor or go up a tier.
    const items: LabelItem[] = [
      { id: "a", anchorX: 100, width: 40 },
      { id: "b", anchorX: 100, width: 40 },
      { id: "c", anchorX: 100, width: 40 },
    ];
    const placed = layoutLabels(items, { maxNudge: 0 });
    expect(hasTierOverlap(placed)).toBe(false);
    // Each must keep its anchor center and occupy a distinct tier.
    expect(placed.every((p) => p.labelX === 100)).toBe(true);
    expect(new Set(placed.map((p) => p.tier)).size).toBe(3);
    expect(tierCount(placed)).toBe(3);
  });

  it("uses tier 0 left-to-right and only spills upward as needed (modest nudge)", () => {
    // Anchors 0,10,20,30 with width 16 and a small nudge budget: some must stack.
    const items: LabelItem[] = [
      { id: "a", anchorX: 0, width: 16 },
      { id: "b", anchorX: 10, width: 16 },
      { id: "c", anchorX: 20, width: 16 },
      { id: "d", anchorX: 30, width: 16 },
    ];
    const placed = layoutLabels(items, { gap: 2, maxNudge: 5 });
    expect(hasTierOverlap(placed)).toBe(false);
    expect(anyOverlapWithinTier(placed)).toBe(false);
  });

  it("never lets a label cross the track's left or right bound", () => {
    const items: LabelItem[] = [
      { id: "a", anchorX: 0, width: 40 }, // would spill left of 0
      { id: "b", anchorX: 500, width: 40 }, // would spill right of 500
    ];
    const placed = layoutLabels(items, { minX: 0, maxX: 500 });
    for (const p of placed) {
      expect(p.labelX - p.width / 2).toBeGreaterThanOrEqual(0 - 1e-6);
      expect(p.labelX + p.width / 2).toBeLessThanOrEqual(500 + 1e-6);
    }
  });

  it("clamps the left-most label's center to keep it inside the left bound", () => {
    const placed = layoutLabels([{ id: "a", anchorX: 0, width: 30 }], { minX: 0, maxX: 1000 });
    expect(placed[0].labelX).toBe(15); // center pushed to half-width
  });

  it("preserves anchorX and width on each placed label", () => {
    const items: LabelItem[] = [{ id: "x", anchorX: 77, width: 33 }];
    const placed = layoutLabels(items);
    expect(placed[0].anchorX).toBe(77);
    expect(placed[0].width).toBe(33);
    expect(placed[0].id).toBe("x");
  });

  it("respects the gap between adjacent labels in a tier", () => {
    const items: LabelItem[] = [
      { id: "a", anchorX: 100, width: 40 },
      { id: "b", anchorX: 110, width: 40 },
    ];
    const gap = 8;
    const placed = layoutLabels(items, { gap });
    const tier0 = placed.filter((p) => p.tier === 0).sort((a, b) => a.labelX - b.labelX);
    if (tier0.length === 2) {
      const left = tier0[0];
      const right = tier0[1];
      const between = right.labelX - right.width / 2 - (left.labelX + left.width / 2);
      expect(between).toBeGreaterThanOrEqual(gap - 1e-6);
    }
  });

  it("is deterministic and order-independent (ties broken by id)", () => {
    const a: LabelItem[] = [
      { id: "b", anchorX: 100, width: 20 },
      { id: "a", anchorX: 100, width: 20 },
    ];
    const b: LabelItem[] = [
      { id: "a", anchorX: 100, width: 20 },
      { id: "b", anchorX: 100, width: 20 },
    ];
    const pa = layoutLabels(a, { maxNudge: 0 });
    const pb = layoutLabels(b, { maxNudge: 0 });
    const norm = (p: PlacedLabel[]) =>
      p
        .map((x) => `${x.id}:${x.tier}:${x.labelX}`)
        .sort()
        .join("|");
    expect(norm(pa)).toBe(norm(pb));
  });

  it("FUZZ: never produces an in-tier overlap for random inputs", () => {
    let rng = 1234567;
    const rand = () => {
      // simple deterministic LCG so the test is reproducible
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff;
    };
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 40);
      const items: LabelItem[] = [];
      for (let i = 0; i < n; i++) {
        items.push({
          id: `i${i}`,
          anchorX: Math.round(rand() * 1000),
          width: 8 + Math.round(rand() * 60),
        });
      }
      const maxNudge = rand() < 0.5 ? 0 : rand() * 30;
      const placed = layoutLabels(items, { gap: 2 + rand() * 6, maxNudge, minX: 0, maxX: 1000 });
      expect(placed).toHaveLength(n);
      expect(hasTierOverlap(placed)).toBe(false);
      expect(anyOverlapWithinTier(placed)).toBe(false);
    }
  });

  it("FUZZ: with nudging disallowed every label keeps its (clamped) anchor center", () => {
    let rng = 42;
    const rand = () => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff;
    };
    for (let trial = 0; trial < 100; trial++) {
      const n = 1 + Math.floor(rand() * 20);
      const items: LabelItem[] = [];
      for (let i = 0; i < n; i++) {
        items.push({ id: `i${i}`, anchorX: Math.round(rand() * 800) + 100, width: 20 });
      }
      const placed = layoutLabels(items, { maxNudge: 0, minX: 0, maxX: 1000 });
      // With no track clamp in play (anchors comfortably inside), labelX == anchorX.
      for (const p of placed) expect(p.labelX).toBe(p.anchorX);
      expect(hasTierOverlap(placed)).toBe(false);
    }
  });
});
