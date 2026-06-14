import { describe, it, expect } from "vitest";
import {
  normalizeRect,
  computeRegionPlan,
  FULL_PAGE_RECT,
  type NormRect,
} from "../pdf-render";

describe("normalizeRect", () => {
  it("passes a clean in-bounds rect through", () => {
    const r: NormRect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(normalizeRect(r)).toEqual(r);
  });

  it("flips a negative-size drag (bottom-right to top-left) into a positive rect", () => {
    // Dragged from (0.5, 0.6) up-left by (-0.2, -0.3).
    const r: NormRect = { x: 0.5, y: 0.6, w: -0.2, h: -0.3 };
    const out = normalizeRect(r);
    expect(out.x).toBeCloseTo(0.3);
    expect(out.y).toBeCloseTo(0.3);
    expect(out.w).toBeCloseTo(0.2);
    expect(out.h).toBeCloseTo(0.3);
  });

  it("clamps a rect that runs off the right/bottom edge", () => {
    const r: NormRect = { x: 0.8, y: 0.9, w: 0.5, h: 0.5 };
    const out = normalizeRect(r);
    expect(out.x + out.w).toBeLessThanOrEqual(1.0000001);
    expect(out.y + out.h).toBeLessThanOrEqual(1.0000001);
  });

  it("falls back to the whole page for a degenerate (tiny) selection", () => {
    const r: NormRect = { x: 0.5, y: 0.5, w: 0.001, h: 0.001 };
    expect(normalizeRect(r)).toEqual(FULL_PAGE_RECT);
  });

  it("falls back to the whole page for a zero-area click", () => {
    const r: NormRect = { x: 0.4, y: 0.4, w: 0, h: 0 };
    expect(normalizeRect(r)).toEqual(FULL_PAGE_RECT);
  });
});

describe("computeRegionPlan", () => {
  const PW = 600; // page natural width
  const PH = 800; // page natural height

  it("scales a small square region UP so its width lands near the target", () => {
    // A region 1/4 of the page width (150px) at a square aspect comfortably fits
    // under the maxOut guard, so it reaches ~1400px wide.
    const plan = computeRegionPlan(PW, PH, { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }, 1400, 2200);
    expect(plan.scale).toBeGreaterThan(1);
    expect(plan.sw).toBeGreaterThan(1200);
    expect(plan.sw).toBeLessThan(1600);
    // The square region's height tracks its width.
    expect(plan.sh).toBeGreaterThan(1200);
  });

  it("never scales below 1 even for a full-page region wider than the target", () => {
    const plan = computeRegionPlan(PW, PH, FULL_PAGE_RECT, 300);
    expect(plan.scale).toBe(1);
    expect(plan.sw).toBe(PW);
    expect(plan.sh).toBe(PH);
  });

  it("clamps both output dimensions to maxOut for a pathological thin-tall strip", () => {
    // A 2%-wide, full-height strip would otherwise demand a huge scale.
    const plan = computeRegionPlan(PW, PH, { x: 0.4, y: 0, w: 0.02, h: 1 }, 1400, 2200);
    expect(plan.sw).toBeLessThanOrEqual(2200);
    expect(plan.sh).toBeLessThanOrEqual(2200);
  });

  it("keeps the output canvas dimensions within maxOut for a normal region", () => {
    const plan = computeRegionPlan(PW, PH, { x: 0.3, y: 0.4, w: 0.4, h: 0.3 }, 1400, 2200);
    expect(plan.sw).toBeLessThanOrEqual(2200);
    expect(plan.sh).toBeLessThanOrEqual(2200);
    expect(plan.sw).toBeGreaterThan(0);
    expect(plan.sh).toBeGreaterThan(0);
  });
});
