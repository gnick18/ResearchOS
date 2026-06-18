// linear map bot — unit tests for the ribbon label PLAN (inline-vs-stacked
// partition + the no-overlap tier packing it delegates to layoutLabels). The
// crux of the SequenceEmbed fix is that (a) names that fit their bar stay inline,
// (b) names that do not get stacked into collision-free tiers with leader lines.

import { describe, expect, it } from "vitest";
import {
  planRibbonLabels,
  estLabelWidth,
  charsThatFit,
  type RibbonLabelInput,
} from "./ribbon-label-layout";
import { hasTierOverlap } from "./label-layout";

const OPTS = { fontPx: 10, minX: 16, maxX: 704 };

describe("estLabelWidth", () => {
  it("scales with text length and font size, floored at 8px", () => {
    expect(estLabelWidth("", 10)).toBe(8);
    expect(estLabelWidth("AmpR", 10)).toBeCloseTo(4 * 10 * 0.58, 5);
    expect(estLabelWidth("AmpR", 20)).toBeGreaterThan(estLabelWidth("AmpR", 10));
  });
});

describe("charsThatFit", () => {
  it("returns fewer chars as the cap shrinks and never below 1", () => {
    const wide = charsThatFit("neomycin phosphotransferase", 10, 200);
    const narrow = charsThatFit("neomycin phosphotransferase", 10, 40);
    expect(wide).toBeGreaterThan(narrow);
    expect(charsThatFit("x", 10, 1)).toBeGreaterThanOrEqual(1);
  });
});

describe("planRibbonLabels", () => {
  it("keeps a name that fits its bar inline (no external label)", () => {
    // A wide bar (300px) easily holds "AmpR".
    const items: RibbonLabelInput[] = [{ id: "a", name: "AmpR", x0: 100, x1: 400 }];
    const plan = planRibbonLabels(items, OPTS);
    expect(plan.inlineIds).toEqual(["a"]);
    expect(plan.external).toHaveLength(0);
    expect(plan.tiers).toBe(0);
  });

  it("stacks a name that does not fit its short bar into an external tier", () => {
    // A 12px bar cannot hold "neomycin phosphotransferase".
    const items: RibbonLabelInput[] = [
      { id: "neo", name: "neomycin phosphotransferase", x0: 200, x1: 212 },
    ];
    const plan = planRibbonLabels(items, OPTS);
    expect(plan.inlineIds).toHaveLength(0);
    expect(plan.external).toHaveLength(1);
    expect(plan.external[0].id).toBe("neo");
    // anchored at the bar midpoint.
    expect(plan.external[0].anchorX).toBe(206);
  });

  it("never overlaps two stacked labels, lifting collisions into tiers", () => {
    // Three short, tightly-packed bars whose long names would all collide.
    const items: RibbonLabelInput[] = [
      { id: "cmv", name: "CMV enhancer", x0: 100, x1: 108 },
      { id: "sv40", name: "SV40 promoter", x0: 112, x1: 120 },
      { id: "neo", name: "neomycin phosphotransferase", x0: 124, x1: 132 },
    ];
    const plan = planRibbonLabels(items, OPTS);
    expect(plan.external).toHaveLength(3);
    expect(plan.tiers).toBeGreaterThan(1);
    expect(hasTierOverlap(plan.external)).toBe(false);
  });

  it("caps an over-long name's reserved width at maxLabelPx", () => {
    const longName = "x".repeat(500);
    const items: RibbonLabelInput[] = [{ id: "big", name: longName, x0: 300, x1: 308 }];
    const plan = planRibbonLabels(items, { ...OPTS, maxLabelPx: 120 });
    expect(plan.external).toHaveLength(1);
    expect(plan.external[0].width).toBe(120);
  });

  it("partitions a mixed set, inlining the roomy bars and stacking the cramped ones", () => {
    const items: RibbonLabelInput[] = [
      { id: "wide", name: "egfp", x0: 100, x1: 400 }, // roomy -> inline
      { id: "tiny", name: "f1 ori", x0: 410, x1: 416 }, // cramped -> stacked
    ];
    const plan = planRibbonLabels(items, OPTS);
    expect(plan.inlineIds).toEqual(["wide"]);
    expect(plan.external.map((p) => p.id)).toEqual(["tiny"]);
    expect(hasTierOverlap(plan.external)).toBe(false);
  });
});
