import { describe, it, expect } from "vitest";
import { centerInContainer, targetSelector, TUTOR_TARGET_ATTR } from "./tutor-target";

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
