import { describe, expect, it } from "vitest";
import { shouldShowOneOnOneTab } from "./oneOnOneGate";

// 1:1 revamp (oneonone surface bot, 2026-06-07). The Workbench 1:1 tab gate:
// a lab head always sees it; a member sees it only with >= 1 active 1:1; a
// solo user with no 1:1s never sees an empty tab.
describe("shouldShowOneOnOneTab", () => {
  it("always shows for a lab head, even with no 1:1s", () => {
    expect(shouldShowOneOnOneTab("lab_head", 0)).toBe(true);
    expect(shouldShowOneOnOneTab("lab_head", 3)).toBe(true);
  });

  it("shows for a member only when they are in at least one 1:1", () => {
    expect(shouldShowOneOnOneTab("member", 0)).toBe(false);
    expect(shouldShowOneOnOneTab("member", 1)).toBe(true);
    expect(shouldShowOneOnOneTab("lab", 2)).toBe(true);
  });

  it("hides for a solo user with no 1:1s (no empty tab)", () => {
    expect(shouldShowOneOnOneTab("solo", 0)).toBe(false);
    expect(shouldShowOneOnOneTab(null, 0)).toBe(false);
    expect(shouldShowOneOnOneTab(undefined, 0)).toBe(false);
  });

  it("shows a solo user who somehow participates in a 1:1", () => {
    expect(shouldShowOneOnOneTab("solo", 1)).toBe(true);
  });
});
