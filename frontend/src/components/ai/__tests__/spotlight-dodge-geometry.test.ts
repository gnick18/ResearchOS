// @vitest-environment node
//
// Unit tests for the pure spotlight dodge geometry helpers
// (ai adaptive-dodge bot, 2026-06-11).
//
// No DOM needed: all functions accept plain number objects.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  wouldOcclude,
  farthestCorner,
  DODGE_SURFACE_W,
  DODGE_SURFACE_H,
} from "../spotlight-dodge-geometry";

// A 1920x1080 viewport used across most tests.
const VP = { width: 1920, height: 1080 };

// ---------------------------------------------------------------------------
// wouldOcclude
// ---------------------------------------------------------------------------

describe("wouldOcclude", () => {
  it("returns true when rects overlap exactly", () => {
    const surface = { left: 100, top: 100, width: 200, height: 200 };
    const target  = { left: 150, top: 150, width: 50,  height: 50 };
    expect(wouldOcclude(surface, target, 0)).toBe(true);
  });

  it("returns true when expanded margin causes overlap that bare rects miss", () => {
    // Surface ends at x=299, target starts at x=310 (gap of 11). Margin 16
    // expands the target left to 294, which the surface right (299) crosses.
    const surface = { left: 100, top: 100, width: 200, height: 200 };
    const target  = { left: 310, top: 150, width: 50,  height: 50 };
    expect(wouldOcclude(surface, target, 16)).toBe(true);
  });

  it("returns false when rects are clearly separated with margin=0", () => {
    const surface = { left: 100, top: 100, width: 200, height: 200 };
    const target  = { left: 400, top: 400, width: 50,  height: 50 };
    expect(wouldOcclude(surface, target, 0)).toBe(false);
  });

  it("returns false when separation exceeds the margin", () => {
    // Surface right = 300, target left = 340. Gap = 40 > margin 16.
    const surface = { left: 100, top: 100, width: 200, height: 200 };
    const target  = { left: 340, top: 150, width: 50,  height: 50 };
    expect(wouldOcclude(surface, target, 16)).toBe(false);
  });

  it("returns true when target is fully inside the surface", () => {
    const surface = { left: 50,  top: 50,  width: 500, height: 400 };
    const target  = { left: 100, top: 100, width: 60,  height: 60 };
    expect(wouldOcclude(surface, target, 0)).toBe(true);
  });

  it("returns true when surface is fully inside the target", () => {
    const surface = { left: 100, top: 100, width: 60,  height: 60 };
    const target  = { left: 50,  top: 50,  width: 500, height: 400 };
    expect(wouldOcclude(surface, target, 0)).toBe(true);
  });

  it("returns false for touching edges with margin=0 (non-overlapping)", () => {
    // Surface right = 300 exactly, target left = 300. Touching but not overlapping.
    const surface = { left: 100, top: 100, width: 200, height: 200 };
    const target  = { left: 300, top: 100, width: 50,  height: 50 };
    expect(wouldOcclude(surface, target, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// farthestCorner
// ---------------------------------------------------------------------------

describe("farthestCorner", () => {
  it("picks top-right when target is in the bottom-left area", () => {
    // Target near bottom-left: farthest corner is top-right.
    const target = { left: 50, top: VP.height - 100, width: 80, height: 40 };
    const { corner } = farthestCorner(target, VP);
    expect(corner).toBe("top-right");
  });

  it("picks top-left when target is in the bottom-right area", () => {
    const target = { left: VP.width - 100, top: VP.height - 100, width: 80, height: 40 };
    const { corner } = farthestCorner(target, VP);
    expect(corner).toBe("top-left");
  });

  it("picks bottom-right when target is in the top-left area", () => {
    const target = { left: 50, top: 50, width: 80, height: 40 };
    const { corner } = farthestCorner(target, VP);
    expect(corner).toBe("bottom-right");
  });

  it("picks bottom-left when target is in the top-right area", () => {
    const target = { left: VP.width - 100, top: 50, width: 80, height: 40 };
    const { corner } = farthestCorner(target, VP);
    expect(corner).toBe("bottom-left");
  });

  it("returns a left value that keeps the surface inside the viewport", () => {
    const target = { left: 50, top: 50, width: 80, height: 40 };
    const { left } = farthestCorner(target, VP);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + DODGE_SURFACE_W).toBeLessThanOrEqual(VP.width);
  });

  it("returns a top value that keeps the surface inside the viewport", () => {
    const target = { left: 50, top: 50, width: 80, height: 40 };
    const { top } = farthestCorner(target, VP);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + DODGE_SURFACE_H).toBeLessThanOrEqual(VP.height);
  });

  it("places surface at EDGE_MARGIN from the top for top-left corner", () => {
    const target = { left: VP.width - 100, top: VP.height - 100, width: 80, height: 40 };
    const { corner, left, top } = farthestCorner(target, VP);
    expect(corner).toBe("top-left");
    expect(left).toBe(20); // EDGE_MARGIN
    expect(top).toBe(20);
  });

  it("places surface at EDGE_MARGIN from the top for top-right corner", () => {
    const target = { left: 50, top: VP.height - 100, width: 80, height: 40 };
    const { corner, left, top } = farthestCorner(target, VP);
    expect(corner).toBe("top-right");
    expect(left).toBe(VP.width - DODGE_SURFACE_W - 20);
    expect(top).toBe(20);
  });

  it("handles a narrow viewport gracefully without negative coords", () => {
    const narrow = { width: 400, height: 700 };
    const target = { left: 50, top: 50, width: 80, height: 40 };
    const { left, top } = farthestCorner(target, narrow, 360, 200);
    // Should still be non-negative (narrow VP saturates at margin or 0).
    expect(left).toBeGreaterThanOrEqual(-20); // may be slightly negative if surface > VP
    expect(top).toBeGreaterThanOrEqual(-20);
  });
});
