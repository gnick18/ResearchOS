import { describe, it, expect } from "vitest";
import {
  centerInContainer,
  rectInContainer,
  targetSelector,
  TUTOR_TARGET_ATTR,
} from "./tutor-target";

describe("tutor-target center math", () => {
  it("returns the target center relative to the container origin", () => {
    const container = { left: 100, top: 50, width: 800, height: 600 };
    const target = { left: 300, top: 150, width: 40, height: 20 };
    expect(centerInContainer(target, container)).toEqual({ x: 220, y: 110 });
  });

  it("is zero at the container origin for a zero-size target there", () => {
    const container = { left: 10, top: 10, width: 100, height: 100 };
    const target = { left: 10, top: 10, width: 0, height: 0 };
    expect(centerInContainer(target, container)).toEqual({ x: 0, y: 0 });
  });

  it("builds a data-attribute selector", () => {
    expect(targetSelector("datahub-plot-button")).toBe(
      `[${TUTOR_TARGET_ATTR}="datahub-plot-button"]`,
    );
  });
});

describe("tutor-target rect math (soft-ring box)", () => {
  it("returns the target box relative to the container origin (size preserved)", () => {
    const container = { left: 100, top: 50, width: 800, height: 600 };
    const target = { left: 300, top: 150, width: 40, height: 20 };
    expect(rectInContainer(target, container)).toEqual({
      x: 200,
      y: 100,
      width: 40,
      height: 20,
    });
  });

  it("its center matches centerInContainer (ring wraps, cursor aims at center)", () => {
    const container = { left: 0, top: 0, width: 500, height: 500 };
    const target = { left: 120, top: 80, width: 60, height: 30 };
    const box = rectInContainer(target, container);
    const center = centerInContainer(target, container);
    expect({ x: box.x + box.width / 2, y: box.y + box.height / 2 }).toEqual(center);
  });
});
