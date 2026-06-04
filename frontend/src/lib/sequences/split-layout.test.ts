import { describe, it, expect } from "vitest";
import {
  clampListWidth,
  DEFAULT_LIST_WIDTH,
  LIST_MIN_WIDTH,
  LIST_MAX_WIDTH,
  VIEWER_MIN_WIDTH,
} from "./split-layout";

describe("clampListWidth", () => {
  // A comfortably wide container where the static LIST_MAX is the binding max.
  const WIDE = 1600;

  it("returns the desired width when it sits inside the range", () => {
    expect(clampListWidth(400, WIDE)).toBe(400);
  });

  it("clamps up to the list minimum when dragged too narrow", () => {
    expect(clampListWidth(100, WIDE)).toBe(LIST_MIN_WIDTH);
    expect(clampListWidth(0, WIDE)).toBe(LIST_MIN_WIDTH);
    expect(clampListWidth(-50, WIDE)).toBe(LIST_MIN_WIDTH);
  });

  it("clamps down to the static list maximum on a wide container", () => {
    expect(clampListWidth(9999, WIDE)).toBe(LIST_MAX_WIDTH);
  });

  it("keeps the viewer above its minimum by shrinking the dynamic max", () => {
    // container 900 -> dynamic max = 900 - 480 = 420, below the static 560.
    const container = 900;
    expect(clampListWidth(800, container)).toBe(container - VIEWER_MIN_WIDTH);
    expect(clampListWidth(800, container)).toBe(420);
    // And the viewer keeps at least its min at that clamped width.
    expect(container - clampListWidth(800, container)).toBe(VIEWER_MIN_WIDTH);
  });

  it("never lets the list drop below its min even on a too-narrow container", () => {
    // container 600 -> 600 - 480 = 120 < LIST_MIN; list min wins.
    expect(clampListWidth(50, 600)).toBe(LIST_MIN_WIDTH);
    expect(clampListWidth(400, 600)).toBe(LIST_MIN_WIDTH);
  });

  it("falls back to the static range before the container is measured", () => {
    expect(clampListWidth(400, 0)).toBe(400);
    expect(clampListWidth(100, 0)).toBe(LIST_MIN_WIDTH);
    expect(clampListWidth(9999, 0)).toBe(LIST_MAX_WIDTH);
    expect(clampListWidth(400, NaN)).toBe(400);
  });

  it("recovers a sane width from a non-finite desired value", () => {
    expect(clampListWidth(NaN, WIDE)).toBe(DEFAULT_LIST_WIDTH);
  });
});
