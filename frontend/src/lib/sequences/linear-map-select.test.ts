import { describe, it, expect } from "vitest";
import {
  spanFromShiftClick,
  buildFeatureCard,
  selectionBandRect,
  normalizeRange,
  circularArcLength,
} from "./linear-map-select";

describe("spanFromShiftClick", () => {
  it("unions an anchor with a later feature", () => {
    expect(spanFromShiftClick({ start: 100, end: 200 }, { start: 500, end: 600 })).toEqual({
      start: 100,
      end: 600,
    });
  });

  it("unions an anchor with an earlier feature (clicked before anchor)", () => {
    expect(spanFromShiftClick({ start: 500, end: 600 }, { start: 100, end: 200 })).toEqual({
      start: 100,
      end: 600,
    });
  });

  it("absorbs a feature fully inside the anchor", () => {
    expect(spanFromShiftClick({ start: 100, end: 900 }, { start: 300, end: 400 })).toEqual({
      start: 100,
      end: 900,
    });
  });

  it("normalizes reversed input ranges", () => {
    expect(spanFromShiftClick({ start: 200, end: 100 }, { start: 600, end: 500 })).toEqual({
      start: 100,
      end: 600,
    });
  });
});

describe("normalizeRange", () => {
  it("swaps a reversed range", () => {
    expect(normalizeRange({ start: 9, end: 2 })).toEqual({ start: 2, end: 9 });
  });
  it("leaves a forward range alone", () => {
    expect(normalizeRange({ start: 2, end: 9 })).toEqual({ start: 2, end: 9 });
  });
});

describe("buildFeatureCard", () => {
  it("shows 1-based range + bp length for a plain feature", () => {
    const card = buildFeatureCard({ name: "ori", start: 100, end: 250, type: "rep_origin" });
    expect(card.title).toBe("ori");
    expect(card.lines[0].value).toBe("101 .. 250");
    expect(card.lines[1]).toEqual({ label: "Length", value: "150 bp" });
    // no protein line for a non-coding feature
    expect(card.lines.some((l) => l.label === "Protein")).toBe(false);
  });

  it("adds an aa + kDa line for a CDS", () => {
    // 900 bp -> 300 aa -> 300*110 = 33,000 Da -> 33.0 kDa
    const card = buildFeatureCard({ name: "AmpR", start: 0, end: 900, type: "CDS" });
    const protein = card.lines.find((l) => l.label === "Protein");
    expect(protein?.value).toBe("300 aa, ~33.0 kDa");
  });

  it("treats gene as coding too", () => {
    const card = buildFeatureCard({ name: "lacZ", start: 0, end: 30, type: "gene" });
    expect(card.lines.some((l) => l.label === "Protein")).toBe(true);
  });

  it("emits a Product line from the note qualifier", () => {
    const card = buildFeatureCard({
      name: "GFP",
      start: 10,
      end: 730,
      type: "CDS",
      note: "green fluorescent protein",
    });
    const product = card.lines.find((l) => l.label === "Product");
    expect(product?.value).toBe("green fluorescent protein");
  });

  it("comma-groups large coordinates", () => {
    const card = buildFeatureCard({ name: "big", start: 12000, end: 1500000, type: "misc" });
    expect(card.lines[0].value).toBe("12,001 .. 1,500,000");
  });
});

describe("circularArcLength (circular qol bot — ring preview/selection arc)", () => {
  const LEN = 5000;

  it("measures a forward span clockwise start -> end", () => {
    expect(circularArcLength(1000, 1500, LEN)).toBe(500);
  });

  it("wraps a zero-crossing span the long way past the origin", () => {
    // a feature from 4800 -> 200 crosses the origin: 5000 - 4800 + 200 = 400 bp.
    expect(circularArcLength(4800, 200, LEN)).toBe(400);
  });

  it("covers the whole circle for a zero-span feature (nudged just under 360)", () => {
    expect(circularArcLength(123, 123, LEN)).toBeCloseTo(LEN - 0.1, 5);
  });

  it("nudges a full-circle span just under a complete arc", () => {
    // start 0, end 5000 -> 5000 bp == seqLength, can't draw a full SVG arc.
    expect(circularArcLength(0, LEN, LEN)).toBeCloseTo(LEN - 0.1, 5);
  });

  it("returns 0 for an empty molecule", () => {
    expect(circularArcLength(0, 0, 0)).toBe(0);
  });
});

describe("selectionBandRect", () => {
  const base = { padX: 16, trackWidth: 1000 };

  it("maps a whole-molecule selection to the full track when window is the molecule", () => {
    const r = selectionBandRect({ selStart: 0, selEnd: 1000, winStart: 0, winEnd: 1000, ...base });
    expect(r).not.toBeNull();
    expect(r!.x0).toBeCloseTo(16, 5);
    expect(r!.x1).toBeCloseTo(1016, 5);
    expect(r!.clampedLeft).toBe(false);
    expect(r!.clampedRight).toBe(false);
  });

  it("returns null for an empty (caret) selection", () => {
    expect(
      selectionBandRect({ selStart: 50, selEnd: 50, winStart: 0, winEnd: 1000, ...base }),
    ).toBeNull();
  });

  it("returns null when the selection is fully outside the window", () => {
    expect(
      selectionBandRect({ selStart: 0, selEnd: 100, winStart: 500, winEnd: 1000, ...base }),
    ).toBeNull();
  });

  it("clips a selection that overruns the left window edge and flags it", () => {
    // window [500,1000], selection [200,700] -> clipped to [500,700]
    const r = selectionBandRect({ selStart: 200, selEnd: 700, winStart: 500, winEnd: 1000, ...base });
    expect(r).not.toBeNull();
    expect(r!.x0).toBeCloseTo(16, 5); // clipped to window start -> left edge
    // 700 is 200/500 across the window -> 16 + 0.4*1000 = 416
    expect(r!.x1).toBeCloseTo(416, 5);
    expect(r!.clampedLeft).toBe(true);
    expect(r!.clampedRight).toBe(false);
  });

  it("flags a right-overrun", () => {
    const r = selectionBandRect({ selStart: 600, selEnd: 1500, winStart: 500, winEnd: 1000, ...base });
    expect(r!.clampedRight).toBe(true);
    expect(r!.x1).toBeCloseTo(1016, 5); // clipped to window end -> right edge
  });
});
